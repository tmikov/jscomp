// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/// <reference path="../typings/tsd.d.ts" />

import assert = require("assert");
import util = require("util");

import StringMap = require("../lib/StringMap");
import bmh = require("../lib/bmh");

import hir = require("./hir");

import OpCode = hir.OpCode;

class DynBuffer
{
    buf: Buffer;
    length: number = 0;

    constructor (hint: number)
    {
        this.buf = new Buffer(hint);
    }

    reserve (extra: number, exactly: boolean): void
    {
        var rlen = this.length + extra;
        var newLength: number;

        if (!exactly) {
            if (rlen <= this.buf.length)
                return;
            newLength = max(this.buf.length * 2, rlen);
        } else {
            if (rlen === this.buf.length)
                return;
            newLength = rlen;
        }

        var old = this.buf;
        this.buf = new Buffer(newLength);
        old.copy(this.buf, 0, 0, this.length);
    }

    addBuffer (s: Buffer, from: number, to: number): void
    {
        this.reserve(to - from, false);
        s.copy(this.buf, this.length, from, to);
        this.length += to - from;
    }

    addASCIIString (s: string): void
    {
        this.reserve(s.length, false);

        var length = this.length;
        for ( var i = 0, e = s.length; i < e; ++i )
            this.buf[length++] = s.charCodeAt(i);
        this.length = length;
    }
}

/**
 *
 * @param s
 * @param inComment tells us that we are in a C-style comment, so ["*","/"] must be escaped too
 * @param from
 * @param to
 * @returns {Buffer}
 */
function escapeCStringBuffer (s: Buffer, inComment: boolean, from?: number, to?: number): Buffer
{
    if (from === void 0)
        from = 0;
    if (to === void 0)
        to = s.length;

    var res: DynBuffer = null;
    var lastIndex = from;
    var lastByte: number = 0;

    for ( var i = from; i < to; ++i ) {
        var byte = s[i];
        if (byte < 32 || byte > 127 || byte === 34 /*"*/ || byte === 92 /*backslash*/ ||
            (byte === 63 /*?*/ && lastByte === 63 /*?*/) || // Trigraphs
            (byte === 47 /*/*/ && lastByte === 42 /***/ && inComment) ||
            (byte === 42 /***/ && lastByte === 47 /*/*/ && inComment))
        {
            if (!res)
                res = new DynBuffer(to - from + 16);
            if (lastIndex < i)
                res.addBuffer(s, lastIndex, i);
            lastIndex = i + 1;
            switch (byte) { // TODO: more escapes
                case 9:  res.addASCIIString("\\t"); break;
                case 10: res.addASCIIString("\\n"); break;
                case 13: res.addASCIIString("\\r"); break;
                case 34: res.addASCIIString('\\"'); break;
                case 63: res.addASCIIString("\\?"); break;
                case 92: res.addASCIIString("\\\\"); break;
                case 42: res.addASCIIString("\\*"); break;
                case 47: res.addASCIIString("\\/"); break;
                default: res.addASCIIString(util.format("\\%d%d%d", byte/64&7, byte/8&7, byte&7)); break;
            }
        }
        lastByte = byte;
    }
    if (res !== null) {
        res.reserve(i - lastIndex, true)
        if (lastIndex < i)
            res.addBuffer(s, lastIndex, i);
        return res.buf;
    }
    else {
        if (from !== 0 || to !== s.length)
            return s.slice(from, to);
        else
            return s;
    }
}

function escapeCString (s: string, inComment: boolean): string
{
    return escapeCStringBuffer(new Buffer(s, "utf8"),inComment).toString("ascii");
}

function bufferIndexOf (haystack: Buffer, haystackLen: number, needle: Buffer, startIndex: number = 0): number
{
    // TODO: full Boyer-Moore, etc
    // see http://stackoverflow.com/questions/3183582/what-is-the-fastest-substring-search-algorithm
    var needleLen = needle.length;

    // Utilize Boyer-Moore-Harspool for needles much smaller than the haystack
    if (needleLen >= 8 && haystackLen - startIndex - needleLen > 1000)
        return bmh.search(haystack, startIndex, haystackLen, needle);

    for ( var i = 0, e = haystackLen - needleLen + 1; i < e; ++i ) {
        var j: number;
        for ( j = 0; j < needleLen && haystack[i+j] === needle[j]; ++j )
        {}
        if (j === needleLen)
            return i;
    }
    return -1;
}

function max (a: number, b: number): number
{
    return a > b ? a : b;
}

function min (a: number, b: number): number
{
    return a < b ? a : b;
}

export class OutputSegment
{
    private obuf: string[] = [];

    public format (...params: any[]): void
    {
        this.obuf.push(util.format.apply(null, arguments));
    }
    public push (x: string): void
    {
        this.obuf.push(x);
    }

    public dump (out: NodeJS.WritableStream): void
    {
        for ( var i = 0, e = this.obuf.length; i < e; ++i )
            out.write(this.obuf[i]);
    }
}

function functionGen (m_backend: CXXBackend, m_fb: hir.FunctionBuilder, m_obuf: OutputSegment)
{
    if (m_fb.isBuiltIn)
        return;
    generateC();
    return;

    function gen (...params: any[])
    {
        m_obuf.push(util.format.apply(null, arguments));
    }

    function strBlock (bb: hir.BasicBlock): string
    {
        return `b${bb.id}`;
    }

    function strEnvAccess (envLevel: number): string
    {
        if (envLevel < 0)
            return "NULL";

        if (envLevel === m_fb.getEnvLevel())
            return "frame.escaped";

        var path = "env";
        for ( var f: hir.FunctionBuilder = m_fb; f = f.parentBuilder; ) {
            if (f.getEnvLevel() === envLevel) {
                return path;
            } else if (f.getEnvSize() > 0) {
                path += "->parent";
            }
        }
        assert(false, util.format("cannot access envLevel %d from envLevel %d (%s)", envLevel, m_fb.getEnvLevel(), m_fb.name));
    }

    function strEscapingVar (v: hir.Var): string
    {
        assert(v.escapes, `variable ${v.name} is not marked as escaping`);
        return util.format("%s->vars[%d]", strEnvAccess(v.envLevel), v.envIndex);
    }

    function strMemValue (lv: hir.MemValue): string
    {
        if (lv instanceof hir.Var) {
            if (lv.local)
                return strMemValue(lv.local);
            else if (lv.param)
                return strMemValue(lv.param);
            else
                return strEscapingVar(lv);
        }
        else if (lv instanceof hir.Param) {
            if (lv.index === 0)
                return `argv[${lv.index}]`; // "this" is always available
            else
                return `(argc > ${lv.index} ? argv[${lv.index}] : JS_UNDEFINED_VALUE)`;
        }
        else if (lv instanceof hir.ArgSlot) {
            return strMemValue(lv.local);
        }
        else if (lv instanceof hir.Local) {
            return `frame.locals[${lv.index}]`;
        }
        else if (lv instanceof hir.SystemReg) {
            switch (lv) {
                case hir.frameReg: return "&frame";
                case hir.argcReg:  return "argc";
                case hir.argvReg:  return "argv";
                case hir.lastThrownValueReg: return "JS_GET_RUNTIME(&frame)->thrownObject";
            }
        }

        assert(false, "unsupported LValue "+ lv);
        return "???";
    }

    function strStringPrim(s: string): string
    {
        var res = "s_strings["+m_backend.addString(s)+"]";
        if (s.length <= 64)
            res += "/*\"" + escapeCString(s, true) + "\"*/";
        return res;
    }

    function strNumberImmediate (n: number): string
    {
        if (isNaN(n))
            return "NAN";
        else if (!isFinite(n))
            return n > 0 ? "INFINITY" : "-INFINITY";
        else {
            var res = String(n);

            if ((n | 0) === n || (n >>> 0) === n) // is it an integer?
                return res;

            if (res.indexOf(".") < 0) // If there is no decimal point, we must add it
                return res + ".0";
            else
                return res;
        }
    }

    function strRValue (rv: hir.RValue): string
    {
        if (<any>rv instanceof hir.MemValue)
            return strMemValue(<hir.MemValue>rv);
        else if (rv === hir.undefinedValue)
            return "JS_UNDEFINED_VALUE";
        else if (rv === hir.nullValue)
            return "JS_NULL_VALUE";
        else if (typeof rv === "number")
            return util.format("js::makeNumberValue(%s)", strNumberImmediate(rv));
        else if (typeof rv === "boolean")
            return `js::makeBooleanValue(${rv ? "true":"false"})`;
        else if (typeof rv === "string")
            return `js::makeStringValue(${strStringPrim(rv)})`;
        else
            return hir.rv2s(rv);
    }

    function strDest (v: hir.LValue): string
    {
        if (v !== hir.nullReg)
            return util.format("%s = ", strMemValue(v));
        else
            return "";
    }

    function strToNumber (rv: hir.RValue): string
    {
        if (hir.isImmediate(rv)) {
            var folded = hir.foldUnary(OpCode.TO_NUMBER, rv);
            if (folded !== null)
                return strNumberImmediate(<number>folded);
        }

        var callerStr: string = "&frame, ";
        return util.format("js::toNumber(%s%s)", callerStr, strRValue(rv));
    }
    function strToInt32 (rv: hir.RValue): string
    {
        var callerStr: string = "&frame, ";
        return hir.isImmediate(rv) ?
            util.format("%d", hir.unwrapImmediate(rv)|0) :
            util.format("js::toInt32(%s%s)", callerStr, strRValue(rv));
    }
    function strToUint32 (rv: hir.RValue): string
    {
        var callerStr: string = "&frame, ";
        return hir.isImmediate(rv) ?
            util.format("%d", hir.unwrapImmediate(rv)|0) :
            util.format("js::toUint32(%s%s)", callerStr, strRValue(rv));
    }

    function strToString (rv: hir.RValue): string
    {
        if (hir.isImmediate(rv)) {
            var folded = hir.foldUnary(OpCode.TO_STRING, rv);
            if (folded !== null)
                return strRValue(rv);
        }

        var callerStr: string = "&frame, ";
        return util.format("js::toString(%s%s)", callerStr, strRValue(rv));
    }

    /**
     * Unwrap a value which we know is numeric
     * @param rv
     */
    function strUnwrapN (rv: hir.RValue): string
    {
        return hir.isImmediate(rv) ? String(hir.unwrapImmediate(rv)) : util.format("%s.raw.nval", strRValue(rv));
    }

    function generateC (): void
    {
        gen("\n// %s\nstatic js::TaggedValue %s (js::StackFrame * caller, js::Env * env, unsigned argc, const js::TaggedValue * argv)\n{\n",
            m_fb.name || "<unnamed>", m_backend.strFunc(m_fb)
        );

        var sourceFile: string = "NULL";
        var sourceLine: number = 0;

        if (hir.hasSourceLocation(m_fb)) {
            sourceFile = '"'+ escapeCString(m_fb.fileName + ":" + (m_fb.name || "<unnamed>"), false) + '"';
            sourceLine = m_fb.line;
        }

        gen("  js::StackFrameN<%d,%d,%d> frame(caller, env, %s, %d);\n",
            m_fb.getEnvSize(), m_fb.getLocalsLength(), m_fb.getParamSlotsCount(),
            sourceFile, sourceLine
        );
        for ( var i = 0, e = m_fb.getTryRecordCount(); i < e; ++i )
            gen("  js::TryRecord tryRec%d;\n", i );
        gen("\n");

        // Keep track if the very last thing we generated was a label, so we can add a ';' after i
        // at the end
        var labelWasLast = false;
        for ( var bi = 0, be = m_fb.getBlockListLength(); bi < be; ++bi ) {
            var bb = m_fb.getBlock(bi);
            labelWasLast = bb.body.length === 0;
            gen("%s:\n", strBlock(bb));
            for ( var ii = 0, ie = bb.body.length-1; ii < ie; ++ii )
                generateInst(bb.body[ii]);

            if (ie >= 0)
                generateJump(bb.body[ii], bi < be - 1 ? m_fb.getBlock(bi+1) : null);
        }
        if (labelWasLast)
            gen("  ;\n");

        gen("}\n");
    }

    function generateCreate (createOp: hir.UnOp): void
    {
        var callerStr: string = "&frame, ";
        gen("  %sjs::makeObjectValue(js::objectCreate(%s%s));\n",
            strDest(createOp.dest), callerStr, strRValue(createOp.src1)
        );
    }

    function generateCreateArguments (createOp: hir.UnOp): void
    {
        var frameStr = "&frame";
        if (createOp.dest === hir.nullReg)
            return;
        gen("  %s = js::makeObjectValue(new (%s) js::Arguments(JS_GET_RUNTIME(%s)->objectPrototype));\n",
            strMemValue(createOp.dest), frameStr, frameStr
        );
        gen("  ((js::Arguments*)%s.raw.oval)->init(%s, argc-1, argv+1);\n",
            strRValue(createOp.dest), frameStr
        );
    }

    function generateLoadSC (loadsc: hir.LoadSCOp): void
    {
        var src: string;
        switch (loadsc.sc) {
            case hir.SysConst.RUNTIME_VAR:
                src = util.format("js::makeObjectValue(JS_GET_RUNTIME(&frame)->%s)", loadsc.arg);
                break;
            case hir.SysConst.ARGUMENTS_LEN:
                src = "js::makeNumberValue(argc)";
                break;
            default:
                assert(false, "Usupported sysconst "+ loadsc.sc);
                return;
        }
        gen("  %s%s;\n", strDest(loadsc.dest), src);
    }

    function generateCallerLine(loc: hir.SourceLocation): void
    {
        if (m_backend.isDebugMode())
            gen("  frame.setLine(%d);\n", loc.line);
    }

    function generateNumericBinop (binop: hir.BinOp, coper: string): void
    {
        gen("  %sjs::makeNumberValue(%s %s %s);\n", strDest(binop.dest),
            strToNumber(binop.src1), coper, strToNumber(binop.src2));
    }

    function generateIntegerBinop (binop: hir.BinOp, coper: string, lsigned: boolean, rsigned: boolean): void
    {
        var l = lsigned ? strToInt32(binop.src1): strToUint32(binop.src1);
        var r = rsigned ? strToInt32(binop.src2): strToUint32(binop.src2);

        gen("  %sjs::makeNumberValue(%s %s %s);\n", strDest(binop.dest), l, coper, r);
    }

    /**
     * A binary operator where we know the operands are numbers
     * @param binop
     * @param coper
     */
    function generateBinop_N (binop: hir.BinOp, coper: string): void
    {
        gen("  %sjs::makeNumberValue(%s %s %s);\n", strDest(binop.dest),
            strUnwrapN(binop.src1), coper, strUnwrapN(binop.src2));
    }

    function generateNumericUnop (unop: hir.UnOp, coper: string): void
    {
        gen("  %sjs::makeNumberValue(%s%s);\n", strDest(unop.dest),
            coper, strToNumber(unop.src1));
    }

    function generateIntegerUnop (unop: hir.UnOp, coper: string): void
    {
        gen("  %sjs::makeNumberValue(%s%s);\n", strDest(unop.dest),
            coper, strToInt32(unop.src1));
    }

    function generateDelete (binop: hir.BinOp): void
    {
        var callerStr = "&frame, ";
        var expr: string = null;

        if (hir.isString(binop.src2)) {
            var strName: string = <string>hir.unwrapImmediate(binop.src2);

            // IMPORTANT: string property names looking like integer numbers must be treated as
            // computed properties
            if (!hir.isValidArrayIndex(strName)) {
                expr = util.format("%s.raw.oval->deleteProperty(%s%s)",
                    strRValue(binop.src1), callerStr, strStringPrim(strName)
                );
            }
        }

        if (expr === null)
            expr = util.format("%s.raw.oval->deleteComputed(%s%s)",
                strRValue(binop.src1), callerStr, strRValue(binop.src2)
            );

        gen("  %s%s;\n", strDest(binop.dest), expr);
    }

    function generateAsm (asm: hir.AsmOp): void
    {
        gen("{");
        for ( var i = 0, e = asm.pat.length; i < e; ++i )
        {
            var pe = asm.pat[i];
            if (typeof pe === "string") {
                gen(<string>pe);
            } else if (typeof pe === "number") {
                gen("(%s)", strRValue(asm.bindings[<number>pe]));
            } else
                assert(false, "unsupported pattern value "+ pe);
        }
        gen(";}\n");
    }

    function generateBinopOutofline (binop: hir.BinOp): void
    {
        var callerStr: string = "&frame, ";
        gen("  %sjs::operator_%s(%s%s, %s);\n",
            strDest(binop.dest),
            hir.oc2s(binop.op),
            callerStr,
            strRValue(binop.src1), strRValue(binop.src2)
        );
    }

    function generateBinop (binop: hir.BinOp): void
    {
        var callerStr = "&frame, ";

        switch (binop.op) {
            case OpCode.ADD:   generateBinopOutofline(binop); break;
            case OpCode.ADD_N: generateNumericBinop(binop, "+"); break;
            case OpCode.SUB_N: generateNumericBinop(binop, "-"); break;
            case OpCode.MUL_N: generateNumericBinop(binop, "*"); break;
            case OpCode.DIV_N: generateNumericBinop(binop, "/"); break;
            case OpCode.MOD_N:
                gen("  %sjs::makeNumberValue(fmod(%s, %s));\n", strDest(binop.dest),
                    strToNumber(binop.src1), strToNumber(binop.src2));
                break;
            case OpCode.SHL_N: generateIntegerBinop(binop, "<<", true, false); break;
            case OpCode.SHR_N: generateIntegerBinop(binop, ">>", false, false); break;
            case OpCode.ASR_N: generateIntegerBinop(binop, ">>", true, false); break;
            case OpCode.OR_N: generateIntegerBinop(binop, "|", true, true); break;
            case OpCode.XOR_N: generateIntegerBinop(binop, "^", true, true); break;
            case OpCode.AND_N: generateIntegerBinop(binop, "&", true, true); break;

            case OpCode.ASSERT_OBJECT:
                gen("  if (!js::isValueTagObject(%s.tag)) js::throwTypeError(%s\"%%s\", %s.raw.sval->getStr());\n",
                    strRValue(binop.src1),
                    callerStr,
                    strToString(binop.src2)
                );
                if (binop.dest !== binop.src1 && binop.dest !== hir.nullReg)
                    gen("  %s%s;\n", strDest(binop.dest), strRValue(binop.src1));
                break;
            case OpCode.ASSERT_FUNC:
                gen("  if (!js::isFunction(%s)) js::throwTypeError(%s\"%%s\", %s.raw.sval->getStr());\n",
                    strRValue(binop.src1),
                    callerStr,
                    strToString(binop.src2)
                );
                if (binop.dest !== binop.src1 && binop.dest !== hir.nullReg)
                    gen("  %s%s;\n", strDest(binop.dest), strRValue(binop.src1));
                break;

            case OpCode.DELETE:
                generateDelete(binop);
                break;

            default:
                if (hir.isBinopConditional(binop.op)) {
                    gen("  %sjs::makeBooleanValue(%s);\n",
                        strDest(binop.dest),
                        strIfOpCond(hir.binopToBincond(binop.op), binop.src1, binop.src2)
                    );
                } else {
                    generateBinopOutofline(binop);
                }
                break;
        }
    }

    function generateUnop (unop: hir.UnOp): void
    {
        var callerStr = "&frame, ";
        switch (unop.op) {
            case OpCode.NEG_N: generateNumericUnop(unop, "-"); break;
            case OpCode.LOG_NOT:
                gen("  %sjs::makeBooleanValue(!js::toBoolean(%s));\n", strDest(unop.dest), strRValue(unop.src1));
                break;
            case OpCode.BIN_NOT_N: generateIntegerUnop(unop, "~"); break;
            case OpCode.TYPEOF:
                gen("  %sjs::makeStringValue(js::operator_TYPEOF(%s%s));\n",
                    strDest(unop.dest), callerStr, strRValue(unop.src1)
                );
                break;
            case OpCode.TO_NUMBER:
                gen("  %sjs::makeNumberValue(%s);\n", strDest(unop.dest), strToNumber(unop.src1));
                break;
            case OpCode.TO_STRING:
                gen("  %s%s;\n", strDest(unop.dest), strToString(unop.src1));
                break;
            case OpCode.TO_OBJECT:
                gen("  %sjs::makeObjectValue(js::toObject(%s%s));\n",
                    strDest(unop.dest), callerStr, strRValue(unop.src1)
                );
                break;
            default:
                assert(false, "Unsupported instruction "+ unop);
                break;
        }
    }

    function generateGet (getop: hir.BinOp): void
    {
        var callerStr = "&frame, ";

        if (hir.isString(getop.src2)) {
            var strName: string = <string>hir.unwrapImmediate(getop.src2);

            // IMPORTANT: string property names looking like integer numbers must be treated as
            // computed properties
            if (!hir.isValidArrayIndex(strName)) {
                gen("  %sjs::get(%s%s, %s);\n",
                    strDest(getop.dest),
                    callerStr,
                    strRValue(getop.src1), strStringPrim(strName)
                );
                return;
            }
        }

        gen("  %sjs::getComputed(%s%s, %s);\n",
            strDest(getop.dest),
            callerStr,
            strRValue(getop.src1), strRValue(getop.src2)
        );
    }

    function generatePut (putop: hir.PutOp): void
    {
        var callerStr = "&frame, ";

        if (hir.isString(putop.propName)) {
            var strName: string = <string>hir.unwrapImmediate(putop.propName);

            // IMPORTANT: string property names looking like integer numbers must be treated as
            // computed properties
            if (!hir.isValidArrayIndex(strName)) {
                gen("  js::put(%s%s, %s, %s);\n",
                    callerStr,
                    strRValue(putop.obj), strStringPrim(strName), strRValue(putop.src)
                );
                return;
            }
        }

        gen("  js::putComputed(%s%s, %s, %s);\n",
            callerStr,
            strRValue(putop.obj), strRValue(putop.propName), strRValue(putop.src)
        );
    }


    function generateInst(inst: hir.Instruction): void
    {
        switch (inst.op) {
            case OpCode.CLOSURE:
                var closureop = <hir.ClosureOp>inst;
                //outCallerLine();
                gen("  %sjs::newFunction(&frame, %s, %s, %d, %s);\n",
                    strDest(closureop.dest),
                    strEnvAccess(closureop.funcRef.getLowestEnvAccessed()),
                    closureop.funcRef.name ? strStringPrim(closureop.funcRef.name) : "NULL",
                    closureop.funcRef.getParamsLength()-1,
                    m_backend.strFunc(closureop.funcRef)
                );
                break;
            case OpCode.CREATE: generateCreate(<hir.UnOp>inst); break;
            case OpCode.CREATE_ARGUMENTS: generateCreateArguments(<hir.UnOp>inst); break;
            case OpCode.LOAD_SC: generateLoadSC(<hir.LoadSCOp>inst); break;
            case OpCode.END_TRY:
                var endTryOp = <hir.EndTryOp>inst;
                gen("  JS_GET_RUNTIME(&frame)->popTry(&tryRec%d);\n", endTryOp.tryId);
                break;
            case OpCode.ASM:    generateAsm(<hir.AsmOp>inst); break;

            case OpCode.ASSIGN:
                var assignop = <hir.AssignOp>inst;
                gen("  %s%s;\n", strDest(assignop.dest), strRValue(assignop.src1));
                break;
            case OpCode.GET: generateGet(<hir.BinOp>inst); break;
            case OpCode.PUT: generatePut(<hir.PutOp>inst); break;
            case OpCode.CALL:
                // TODO: self tail-recursion optimization
                var callop = <hir.CallOp>inst;
                generateCallerLine(callop);
                gen("  %s%s(&frame, %s, %d, &%s);\n",
                    strDest(callop.dest),
                    m_backend.strFunc(callop.fref),
                    strEnvAccess(callop.fref.getLowestEnvAccessed()),
                    callop.args.length,
                    strMemValue(callop.args[0])
                );
                break;
            case OpCode.CALLIND:
                var callop = <hir.CallOp>inst;
                generateCallerLine(callop);
                gen("  %sjs::call(&frame, %s, %d, &%s);\n",
                    strDest(callop.dest),
                    strRValue(callop.closure),
                    callop.args.length,
                    strMemValue(callop.args[0])
                );
                break;
            case OpCode.CALLCONS:
                var callop = <hir.CallOp>inst;
                generateCallerLine(callop);
                gen("  %sjs::callCons(&frame, %s, %d, &%s);\n",
                    strDest(callop.dest),
                    strRValue(callop.closure),
                    callop.args.length,
                    strMemValue(callop.args[0])
                );
                break;
            default:
                if (inst.op >= OpCode._BINOP_FIRST && inst.op <= OpCode._BINOP_LAST) {
                    generateBinop(<hir.BinOp>inst);
                } else if (inst.op >= OpCode._UNOP_FIRST && inst.op <= OpCode._UNOP_LAST) {
                    generateUnop(<hir.UnOp>inst);
                }
                else {
                    assert(false, "Unsupported instruction "+ inst);
                }
                break;
        }
    }

    function strIfIn (src1: hir.RValue, src2: hir.RValue): string
    {
        var callerStr = "&frame, ";

        if (hir.isString(src1)) {
            var strName: string = <string>hir.unwrapImmediate(src1);

            // IMPORTANT: string property names looking like integer numbers must be treated as
            // computed properties, but if not, we can go the faster way
            if (!hir.isValidArrayIndex(strName)) {
                return util.format("%s.raw.oval->hasProperty(%s)",
                    strRValue(src2), strStringPrim(strName)
                );
            }
        }

        return util.format("(%s.raw.oval->hasComputed(%s%s) != 0)",
            strRValue(src2), callerStr, strRValue(src1)
        );
    }

    function strIfOpCond (op: OpCode, src1: hir.RValue, src2: hir.RValue): string
    {
        var callerStr: string = "&frame, ";
        var cond: string;

        assert(op >= OpCode._IF_FIRST && op <= OpCode._IF_LAST);

        switch (op) {
            case OpCode.IF_TRUE:
                cond = util.format("js::toBoolean(%s)", strRValue(src1));
                break;
            case OpCode.IF_IS_OBJECT:
                cond = util.format("js::isValueTagObject(%s.tag)", strRValue(src1));
                break;
            case OpCode.IF_STRICT_EQ:
                cond = util.format("operator_%s(%s, %s)",
                    hir.oc2s(op), strRValue(src1), strRValue(src2)
                );
                break;
            case OpCode.IF_STRICT_NE:
                cond = util.format("!operator_%s(%s, %s)",
                    hir.oc2s(OpCode.IF_STRICT_EQ), strRValue(src1), strRValue(src2)
                );
                break;
            case OpCode.IF_LOOSE_EQ:
                cond = util.format("operator_%s(%s%s, %s)",
                    hir.oc2s(op), callerStr, strRValue(src1), strRValue(src2)
                );
                break;
            case OpCode.IF_LOOSE_NE:
                cond = util.format("!operator_%s(%s%s, %s)",
                    hir.oc2s(OpCode.IF_LOOSE_EQ), callerStr, strRValue(src1), strRValue(src2)
                );
                break;

            case OpCode.IF_IN:
                cond = strIfIn(src1, src2);
                break;
            case OpCode.IF_INSTANCEOF:
                cond = util.format("operator_IF_INSTANCEOF(%s%s, %s.raw.fval)",
                    callerStr, strRValue(src1), strRValue(src2)
                );
                break;

            default:
                if (op >= OpCode._BINCOND_FIRST && op <= OpCode._BINCOND_LAST) {
                    cond = util.format("operator_%s(%s%s, %s)",
                        hir.oc2s(op), callerStr, strRValue(src1), strRValue(src2)
                    );
                } else {
                    cond = util.format("operator_%s(%s)", hir.oc2s(op), strRValue(src1));
                }
                break;
        }
        return cond;
    }

    /**
     * Generate a jump instruction, taking care of the fall-through case.
     * @param inst
     * @param nextBB
     */
    function generateJump (inst: hir.Instruction, nextBB: hir.BasicBlock): void
    {
        var callerStr: string = "&frame, ";
        assert(inst instanceof hir.JumpInstruction);
        var jump = <hir.JumpInstruction>inst;

        var bb1 = jump.label1 && jump.label1.bb;
        var bb2 = jump.label2 && jump.label2.bb;

        switch (jump.op) {
            case OpCode.RET:
                var retop = <hir.RetOp>jump;
                gen("  return %s;\n", strRValue(retop.src));
                break;
            case OpCode.THROW:
                var throwOp = <hir.ThrowOp>jump;
                gen("  js::throwValue(%s%s);\n", callerStr, strRValue(throwOp.src));
                break;
            case OpCode.GOTO:
                if (bb1 !== nextBB)
                    gen("  goto %s;\n", strBlock(bb1));
                break;
            case OpCode.BEGIN_TRY:
                var beginTryOp = <hir.BeginTryOp>jump;
                gen("  JS_GET_RUNTIME(&frame)->pushTry(&tryRec%d);\n", beginTryOp.tryId);
                gen("  if (::setjmp(tryRec%d.jbuf) == 0) goto %s; else goto %s;\n",
                    beginTryOp.tryId, strBlock(bb1), strBlock(bb2)
                );
                break;
            case OpCode.SWITCH:
                var switchOp = <hir.SwitchOp>jump;
                gen("  switch ((int32_t)%s.raw.nval) {", strRValue(switchOp.selector));
                for ( var i = 0; i < switchOp.values.length; ++i )
                    gen(" case %d: goto %s;", switchOp.values[i], strBlock(switchOp.targets[i].bb));
                if (switchOp.label2)
                    if (bb2 !== nextBB)
                        gen(" default: goto %s;", strBlock(bb2));
                gen(" };\n");
                break;
            default:
                if (jump.op >= OpCode._IF_FIRST && jump.op <= OpCode._IF_LAST) {
                    var ifop = <hir.IfOp>jump;
                    var cond = strIfOpCond(ifop.op, ifop.src1, ifop.src2);

                    if (bb2 === nextBB)
                        gen("  if (%s) goto %s;\n", cond, strBlock(bb1));
                    else if (bb1 === nextBB)
                        gen("  if (!%s) goto %s;\n", cond, strBlock(bb2));
                    else
                        gen("  if (%s) goto %s; else goto %s;\n", cond, strBlock(bb1), strBlock(bb2));
                } else {
                    assert(false, "unknown instructiopn "+ jump);
                }
        }

    }
}

export class CXXBackend
{
    private topLevel: hir.FunctionBuilder;
    private asmHeaders : string[];
    private debugMode: boolean;

    private strings : string[] = [];
    private stringMap = new StringMap<number>();

    private codeSeg = new OutputSegment();

    constructor (topLevel: hir.FunctionBuilder, asmHeaders: string[], debugMode: boolean)
    {
        this.topLevel = topLevel;
        this.asmHeaders = asmHeaders;
        this.debugMode = debugMode;
    }

    isDebugMode (): boolean
    {
        return this.debugMode;
    }

    addString (s: string): number {
        var n: number;
        if ( (n = this.stringMap.get(s)) === void 0) {
            n = this.strings.length;
            this.strings.push(s);
            this.stringMap.set(s, n);
        }
        return n;
    }

    strFunc (fref: hir.FunctionBuilder): string
    {
        return fref.mangledName;
    }

    private gen (...params: any[])
    {
        this.codeSeg.push(util.format.apply(null, arguments));
    }

    private outputStringStorage (out: NodeJS.WritableStream): void
    {
        if (!this.strings.length)
            return;
        /* TODO: to generalized suffix tree mapping.
         Something like this?
         - sort strings in decreasing length
         - start with an empty string buffer
         - for each string
         - if found in the string buffer use that position
         - append to the string buffer
         */
        var index: number[] = new Array<number>(this.strings.length);
        var offsets: number[] = new Array<number>(this.strings.length);
        var lengths: number[] = new Array<number>(this.strings.length);

        // Sort the strings in decreasing length
        var e = this.strings.length;
        var i : number;
        var totalLength = 0; // the combined length of all strings as initial guess for our buffer
        for ( i = 0; i < e; ++i ) {
            index[i] = i;
            totalLength += this.strings[i].length;
        }

        index.sort( (a: number, b:number) => this.strings[b].length - this.strings[a].length);

        var buf = new DynBuffer(totalLength);

        for ( i = 0; i < e; ++i ) {
            var ii = index[i];
            var s = this.strings[ii];
            var encoded = new Buffer(s, "utf8");
            var pos: number = bufferIndexOf(buf.buf, buf.length, encoded);

            if (pos < 0) { // Append to the buffer
                pos = buf.length;
                buf.addBuffer(encoded, 0, encoded.length);
            }

            offsets[ii] = pos;
            lengths[ii] = encoded.length;
        }

        out.write(util.format("static const js::StringPrim * s_strings[%d];\n", this.strings.length));
        out.write("static const char s_strconst[] =\n");
        var line: string;
        var margin = 72;

        for ( var ofs = 0; ofs < buf.length; )
        {
            var to = min(buf.length, ofs + margin);
            line = "  \"" + escapeCStringBuffer(buf.buf, false, ofs, to) + "\"";
            if (to === buf.length)
                line += ";";
            line += "\n";
            out.write(line);
            ofs = to;
        }

        line = util.format("static const unsigned s_strofs[%d] = {", this.strings.length*2);

        for ( var i = 0; i < this.strings.length; ++i ) {
            var t = util.format("%d,%d", offsets[i], lengths[i]);
            if (line.length + t.length + 1 > margin) {
                out.write(line += i > 0 ? ",\n" : "\n");
                line = "  "+t;
            } else {
                line += i > 0 ? "," + t : t;
            }
        }
        line += "};\n\n";
        out.write(line);
    }

    generateC (out: NodeJS.WritableStream, strictMode: boolean): void
    {
        var forEachFunc = (m_fb: hir.FunctionBuilder, cb: (m_fb: hir.FunctionBuilder)=>void) => {
            if (m_fb !== this.topLevel)
                cb(m_fb);
            m_fb.closures.forEach((m_fb) => forEachFunc(m_fb, cb));
        };

        forEachFunc(this.topLevel, (m_fb) => {
            if (!m_fb.isBuiltIn)
                this.gen("static js::TaggedValue %s (js::StackFrame*, js::Env*, unsigned, const js::TaggedValue*); // %s\n",
                    this.strFunc(m_fb), m_fb.name || "<unnamed>"
                );
        });
        this.gen("\n");
        forEachFunc(this.topLevel, (m_fb) => functionGen(this, m_fb, this.codeSeg));

        this.gen(
            `
int main(int argc, const char ** argv)
{
    js::g_runtime = new js::Runtime(${strictMode}, argc, argv);
    js::StackFrameN<0, 1, 0> frame(NULL, NULL, __FILE__ ":main", __LINE__);
`
        );
        if (this.strings.length > 0) {
            this.gen(util.format(
                "    JS_GET_RUNTIME(&frame)->initStrings(&frame, s_strings, s_strconst, s_strofs, %d);",
                this.strings.length
            ));
        }

        this.gen(
            `
    frame.setLine(__LINE__+1);
    frame.locals[0] = js::makeObjectValue(new(&frame) js::Object(JS_GET_RUNTIME(&frame)->objectPrototype));
    frame.setLine(__LINE__+1);
    ${this.topLevel.closures[0].mangledName}(&frame, JS_GET_RUNTIME(&frame)->env, 1, frame.locals);

    if (JS_GET_RUNTIME(&frame)->diagFlags & (js::Runtime::DIAG_HEAP_GC | js::Runtime::DIAG_FORCE_GC))
        js::forceGC(&frame);

    return 0;
}`
        );

        out.write(util.format("#include <jsc/jsruntime.h>\n"));
        // Generate the headers added with __asmh__
        this.asmHeaders.forEach((h: string) => out.write(util.format("%s\n", h)));
        out.write("\n");

        this.outputStringStorage(out);

        this.codeSeg.dump(out);
    }
}
