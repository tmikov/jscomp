// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/// <reference path="../typings/tsd.d.ts" />

import assert = require("assert");
import util = require("util");

export class MemValue
{
    constructor(public id: number) {}
}

export class LValue extends MemValue
{
}

export class NullReg extends LValue
{
    toString (): string { return "#nullReg"; }
}

export class Regex
{
    constructor (public pattern: string, public flags: string) {}
    toString(): string { return `Regex(/${this.pattern}/${this.flags})`; }
}

export class FunctionRef
{
    constructor (public id: number, public name: string) {}
    toString (): string { return `FunctionRef(${this.id}:${this.name})`; }
}

/** for null and undefined */
export class SpecialConstantClass
{
    constructor (public name: string) {}
    toString(): string { return `#${this.name}`; }
}

export type RValue = MemValue | string | boolean | number | Regex | SpecialConstantClass;

export class Param extends MemValue
{
    index: number;
    name: string;
    variable: Var;

    constructor(id: number, index: number, name: string, variable: Var)
    {
        super(id);
        this.index = index;
        this.name = name;
        this.variable = variable;
        variable.formalParam = this;
    }
    toString() { return `Param(${this.index}/*${this.name}*/)`; }
}

export class ArgSlot extends MemValue
{
    local: Local = null;

    constructor (id: number, public index: number) { super(id); }
    toString() {
        if (this.local)
            return this.local.toString();
        else
            return `Arg(${this.index})`;
    }
}

export class Var extends LValue
{
    envLevel: number; //< environment nesting level
    name: string;
    formalParam: Param = null; // associated formal parameter
    funcRef: FunctionRef = null;
    escapes: boolean = false;
    constant: boolean = false;
    accessed: boolean = true;
    local: Local = null; // The corresponding local to use if it doesn't escape
    param: Param = null; // The corresponding param to use if it is constant and doesn't escape
    envIndex: number = -1; //< index in its environment block, if it escapes

    constructor(id: number, envLevel: number, name: string)
    {
        super(id);
        this.envLevel = envLevel;
        this.name = name;
    }

    toString()
    {
        if (this.local)
            return this.local.toString();
        else if (this.param)
            return this.param.toString();
        else
            return `Var(env@${this.envLevel}[${this.envIndex}]/*${this.name}*/)`;
    }
}

export class Local extends LValue
{
    isTemp: boolean = false; // for users of the module. Has no meaning internally
    index: number;

    constructor(id: number, index: number)
    {
        super(id);
        this.index = index;
    }
    toString() { return `Local(${this.index})`; }
}

export var nullValue = new SpecialConstantClass("null");
export var undefinedValue = new SpecialConstantClass("undefined");
export var nullReg = new NullReg(0);

export function uwrapImmedate (v: RValue): any
{
    if (v === nullValue)
        return null;
    else if (v === undefinedValue)
        return void 0;
    else
        return v;
}

export function wrapImmediate (v: any): RValue
{
    if (v === void 0)
        return undefinedValue;
    else if (v === null)
        return nullValue;
    else
        return v;
}

export function isImmediate (v: RValue): boolean
{
    switch (typeof v) {
        case "string":
        case "boolean":
        case "number":
            return true;
        case "object":
            return <any>v instanceof SpecialConstantClass || <any>v instanceof Regex;
    }
    return false;
}

export function isLValue (v: RValue): LValue
{
    if (<any>v instanceof LValue)
        return <LValue>v;
    else
        return null;
}

export function isVar (v: RValue): Var
{
    if (<any>v instanceof Var)
        return <Var>v;
    else
        return null;
}

export function isTempLocal (v: RValue): Local
{
    if (<any>v instanceof Local) {
        var l = <Local>v;
        if (l.isTemp)
            return l;
    }
    return null;
}


// Note: in theory all comparisons can be simulated using only '<' and '=='.
// a < b   = LESS(a,b)
// a > b   = LESS(b,a)
// a >= b  = !LESS(a,b)
// a <= b  = !LESS(b,a)
// a != b  = !(a == b)
// However things fall apart when floating point is involved because comparions between
// NaN-s always return false. So, we cannot use equivalencies involving a logical negation.
// We need '<', '<=', '==' and '!='.
// a < b
// a > b  <==> b < a
// a <= b
// a >= b <==> b <= a
// a == b
// a != b

export const enum OpCode
{
    // Special
    CLOSURE,

    // Binary
    STRICT_EQ,
    STRICT_NE,
    LOOSE_EQ,
    LOOSE_NE,
    LT,
    LE,
    SHL,
    SHR,
    ASR,
    ADD,
    SUB,
    MUL,
    DIV,
    MOD,
    OR,
    XOR,
    AND,
    IN,
    INSTANCEOF,

    // Unary
    NEG,
    UPLUS,
    LOG_NOT,
    BIN_NOT,
    TYPEOF,
    VOID,
    DELETE,
    TO_NUMBER,

    // Assignment
    ASSIGN,

    // Property access
    GET,
    PUT,

    // Call
    CALL,
    CALLIND,

    // Unconditional jumps
    RET,
    GOTO,

    // Conditional jumps
    IF_TRUE,
    IF_STRICT_EQ,
    IF_STRICT_NE,
    IF_LOOSE_EQ,
    IF_LOOSE_NE,
    IF_LT,
    IF_LE,

    _BINOP_FIRST = STRICT_EQ,
    _BINOP_LAST = INSTANCEOF,
    _UNOP_FIRST = NEG,
    _UNOP_LAST = TO_NUMBER,
    _BINCOND_FIRST = IF_STRICT_EQ,
    _BINCOND_LAST = IF_LE,
    _JUMP_FIRST = RET,
    _JUMP_LAST = IF_LE,
}

var g_opcodeName: string[] = [
    // Special
    "CLOSURE",

    // Binary
    "STRICT_EQ",
    "STRICT_NE",
    "LOOSE_EQ",
    "LOOSE_NE",
    "LT",
    "LE",
    "SHL",
    "SHR",
    "ASR",
    "ADD",
    "SUB",
    "MUL",
    "DIV",
    "MOD",
    "OR",
    "XOR",
    "AND",
    "IN",
    "INSTANCEOF",

    // Unary
    "NEG",
    "UPLUS",
    "LOG_NOT",
    "BIN_NOT",
    "TYPEOF",
    "VOID",
    "DELETE",
    "TO_NUMBER",

    // Assignment
    "ASSIGN",

    // Property access
    "GET",
    "PUT",

    // Call
    "CALL",
    "CALLIND",

    // Unconditional jumps
    "RET",
    "GOTO",

    // Conditional jumps
    "IF_TRUE",
    "IF_STRICT_EQ",
    "IF_STRICT_NE",
    "IF_LOOSE_EQ",
    "IF_LOOSE_NE",
    "IF_LT",
    "IF_LE",
];

// Note: surprisingly, 'ADD' is not commutative because 'string+x' is not the same as 'x+string'
// Ain't dynamic typing great?
var g_binOpCommutative: boolean[] = [
    true,  //STRICT_EQ,
    true,  //STRICT_NE,
    true,  //LOOSE_EQ,
    true,  //LOOSE_NE,
    false, //LT,
    false, //LE,
    false, //SHL,
    false, //SHR,
    false, //ASR,
    false, //ADD,
    false, //SUB,
    true,  //MUL,
    false, //DIV,
    false, //MOD,
    true,  //OR,
    true,  //XOR,
    true,  //AND,
    false, //IN,
    false, //INSTANCEOF
];


export function isCommutative (op: OpCode)
{
    assert(op >= OpCode._BINOP_FIRST && op <= OpCode._BINOP_LAST);
    return g_binOpCommutative[op - OpCode._BINOP_FIRST];
}

export function isJump (op: OpCode)
{
    return op >= OpCode._JUMP_FIRST && op <= OpCode._JUMP_LAST;
}

export function binopToBincond (op: OpCode): OpCode
{
    assert(op >= OpCode._BINOP_FIRST && op <= OpCode._BINOP_FIRST + OpCode._BINCOND_LAST - OpCode._BINCOND_FIRST);
    return op + OpCode._BINCOND_FIRST - OpCode._BINOP_FIRST;
}

function rv2s (v: RValue): string
{
    if (v === null)
        return "";
    else if (typeof v === "string")
        return "\"" + v + "\""; // FIXME: escaping, etc
    else
        return String(v); // FIXME: regex, other types, etc
}

function oc2s (op: OpCode): string
{
    return g_opcodeName[op];
}

class Instruction {
    constructor (public op: OpCode) {}
}
class ClosureOp extends Instruction {
    constructor (public dest: LValue, public funcRef: FunctionRef) { super(OpCode.CLOSURE); }
    toString (): string {
            return `${rv2s(this.dest)} = ${oc2s(this.op)}(${this.funcRef})`;
    }
}
class BinOp extends Instruction {
    constructor (op: OpCode, public dest: LValue, public src1: RValue, public src2: RValue) { super(op); }
    toString (): string {
        if (this.src2)
            return `${rv2s(this.dest)} = ${oc2s(this.op)}(${rv2s(this.src1)}, ${rv2s(this.src2)})`;
        else
            return `${rv2s(this.dest)} = ${oc2s(this.op)}(${rv2s(this.src1)})`;
    }
}
class UnOp extends BinOp {
    constructor (op: OpCode, dest: LValue, src: RValue) { super(op, dest, src, null); }
}
class AssignOp extends UnOp {
    constructor (dest: LValue, src: RValue) { super(OpCode.ASSIGN, dest, src); }
    toString (): string {
        return `${rv2s(this.dest)} = ${rv2s(this.src1)}`;
    }
}

class PutOp extends Instruction {
    constructor (public obj: RValue, public propName: RValue, public src: RValue) { super(OpCode.PUT); }
    toString (): string {
        return `${oc2s(this.op)}(${rv2s(this.obj)}, ${rv2s(this.propName)}, ${rv2s(this.src)})`;
    }
}

class CallOp extends Instruction {
    constructor(
        op: OpCode, public dest: LValue, public fref: FunctionRef, public closure: RValue, public args: ArgSlot[]
    )
    {
        super(op);
    }

    toString (): string {
        if (this.fref)
            return `${rv2s(this.dest)} = ${oc2s(this.op)}(${this.fref}, ${this.closure}, [${this.args}])`;
        else
            return `${rv2s(this.dest)} = ${oc2s(this.op)}(${this.closure}, [${this.args}])`;
    }
}
class JumpInstruction extends Instruction {
    constructor (op: OpCode, public label1: Label, public label2: Label)  { super(op); }
}
class RetOp extends JumpInstruction {
    constructor (label1: Label, public src: RValue) { super(OpCode.RET, label1, null); }
    toString (): string {
        return `ret ${this.label1}, ${rv2s(this.src)}`;
    }
}
class GotoOp extends JumpInstruction {
    constructor (target: Label) { super(OpCode.GOTO, target, null); }
    toString(): string {
        return `${oc2s(this.op)} ${this.label1}`;
    }
}
class IfOp extends JumpInstruction {
    constructor (op: OpCode, public src1: RValue, public src2: RValue, onTrue: Label, onFalse: Label)
    {
        super(op, onTrue, onFalse);
    }
    toString (): string {
        if (this.src2 !== null)
            return `${oc2s(this.op)}(${rv2s(this.src1)}, ${rv2s(this.src2)}) ${this.label1} else ${this.label2}`;
        else
            return `${oc2s(this.op)}(${rv2s(this.src1)}) ${this.label1} else ${this.label2}`;
    }
}

export class Label
{
    bb: BasicBlock = null;
    constructor(public id: number) {}
    toString() { return `B${this.bb.id}`; }
}

class BasicBlock
{
    id: number;
    body: Instruction[] = [];
    labels: Label[] = [];
    succ: Label[] = [];

    constructor (id: number)
    {
        this.id = id;
    }

    insertAt (at: number, inst: Instruction): void
    {
        this.body.splice(at, 0, inst);
    }

    push (inst: Instruction): void
    {
        this.body.push(inst);
    }

    jump (inst: JumpInstruction): void
    {
        this.push(inst);
        if (inst.label1)
            this.succ.push(inst.label1);
        if (inst.label2)
            this.succ.push(inst.label2);
    }

    placeLabel (lab: Label): void
    {
        assert(!this.body.length);
        assert(!lab.bb);
        lab.bb = this;
        this.labels.push(lab);
    }
}

/**
 *
 * @param op
 * @param v1
 * @param v2
 * @returns  RValue folded value or null if the operands cannot be folded at compile time
 */
export function foldBinary (op: OpCode, v1: RValue, v2: RValue): RValue
{
    if (!isImmediate(v1) || !isImmediate(v2))
        return null;
    var a1: any = uwrapImmedate(v1);
    var a2: any = uwrapImmedate(v2);
    var r: any;
    switch (op) {
        case OpCode.STRICT_EQ: r = a1 === a2; break;
        case OpCode.STRICT_NE: r = a1 !== a2; break;
        case OpCode.LOOSE_EQ:  r = a1 == a2; break;
        case OpCode.LOOSE_NE:  r = a1 != a2; break;
        case OpCode.LT:        r = a1 < a2; break;
        case OpCode.LE:        r = a1 <= a2; break;
        case OpCode.SHL:       r = a1 << a2; break;
        case OpCode.SHR:       r = a1 >> a2; break;
        case OpCode.ASR:       r = a1 >>> a2; break;
        case OpCode.ADD:       r = a1 + a2; break;
        case OpCode.SUB:       r = a1 - a2; break;
        case OpCode.MUL:       r = a1 * a2; break;
        case OpCode.DIV:       r = a1 / a2; break;
        case OpCode.MOD:       r = a1 % a2; break;
        case OpCode.OR:        r = a1 | a2; break;
        case OpCode.XOR:       r = a1 ^ a2; break;
        case OpCode.AND:       r = a1 & a2; break;
        case OpCode.IN:        return null;
        case OpCode.INSTANCEOF: return null;
        default:              return null;
    }

    return wrapImmediate(r);
}

export function isImmediateTrue (v: RValue): boolean
{
    assert(isImmediate(v));
    return !!uwrapImmedate(v);
}

/**
 *
 * @param op
 * @param v
 * @returns  RValue folded value or null if the operand cannot be folded at compile time
 */
export function foldUnary (op: OpCode, v: RValue): RValue
{
    if (!isImmediate(v))
        return null;
    var a: any = uwrapImmedate(v);
    var r: any;
    switch (op) {
        case OpCode.NEG:     r = -a; break;
        case OpCode.UPLUS:   r = +a; break;
        case OpCode.LOG_NOT: r = !a; break;
        case OpCode.BIN_NOT: r = ~a; break;
        case OpCode.TYPEOF:  r = typeof a; break;
        case OpCode.VOID:    r = void 0; break;
        case OpCode.DELETE:  return null;
        case OpCode.TO_NUMBER: r = Number(a);
        default: return null;
    }
    return wrapImmediate(r);
}


function bfs (entry: BasicBlock, exit: BasicBlock, callback: (bb: BasicBlock)=>void): void
{
    var visited: boolean[] = [];
    var queue: BasicBlock[] = [];

    function enque (bb: BasicBlock): void {
        if (!visited[bb.id]) {
            visited[bb.id] = true;
            queue.push(bb);
        }
    }
    function visit (bb: BasicBlock): void {
        callback(bb);
        for (var i = 0, e = bb.succ.length; i < e; ++i)
            enque(bb.succ[i].bb );
    }

    // Mark the exit node as visited to guarantee we will visit it last
    visited[exit.id] = true;

    visit(entry);
    while (queue.length)
        visit(queue.shift());
    // Finally generate the exit node
    visit(exit);
}

function buildBlockList (entry: BasicBlock, exit: BasicBlock): BasicBlock[]
{
    var blockList: BasicBlock[] = [];
    bfs(entry, exit, (bb: BasicBlock) => blockList.push(bb));
    return blockList;
}

export class FunctionBuilder
{
    private module: ModuleBuilder;
    private parentBuilder: FunctionBuilder;
    private fref: FunctionRef;

    // The nesting level of this function's environment
    private envLevel: number;

    private params: Param[] = [];
    private locals: Local[] = [];
    private vars: Var[] = [];
    private envSize: number = 0; //< the size of the escaping environment block
    private paramSlotsCount: number = 0; //< number of slots to copy params into
    private paramSlots: Local[] = null;
    private argSlotsCount: number = 0; //< number of slots we need to reserve for calling
    private argSlots: ArgSlot[] = [];

    private nextParamIndex = 0;
    private nextLocalId = 1;
    private nextLabelId = 0;
    private nextBBId = 0;

    private closed = false;
    private curBB: BasicBlock = null;
    private entryBB: BasicBlock = null;
    private exitBB: BasicBlock = null;
    private exitLabel: Label = null;

    private innerFunctions: FunctionBuilder[] = [];

    constructor(module: ModuleBuilder, parentBuilder: FunctionBuilder, fref: FunctionRef)
    {
        this.module = module;
        this.parentBuilder = parentBuilder;
        this.fref = fref;

        this.envLevel = parentBuilder ? parentBuilder.envLevel + 1 : -1;

        if (parentBuilder)
            parentBuilder.addInnerFunction(this);

        this.nextLocalId = parentBuilder ? parentBuilder.nextLocalId+1 : 1;

        this.entryBB = this.getBB();
        this.exitLabel = this.newLabel();
    }
    toString() { return `Function(${this.fref})`; }

    private addInnerFunction (f: FunctionBuilder): void
    {
        this.innerFunctions.push(f);
    }

    newParam(name: string): Param
    {
        var param = new Param(this.nextLocalId++, this.nextParamIndex++, name, this.newVar(name));
        this.params.push(param);
        return param;
    }

    private getArgSlot(index: number): ArgSlot
    {
        if (index < this.argSlots.length)
            return this.argSlots[index];
        assert(index === this.argSlots.length);

        var argSlot = new ArgSlot(this.nextLocalId++, this.argSlotsCount++);
        this.argSlots.push(argSlot);
        return argSlot;
    }

    newVar(name: string): Var
    {
        var v = new Var(this.nextLocalId++, this.envLevel, name);
        this.vars.push(v);
        return v;
    }

    newLocal(): Local
    {
        var loc = new Local(this.nextLocalId++, this.locals.length);
        this.locals.push(loc);
        return loc;
    }

    newLabel(): Label
    {
        var lab = new Label(this.nextLabelId++);
        return lab;
    }

    setVarAttributes (v: Var, escapes: boolean, accessed: boolean, constant: boolean, funcRef: FunctionRef): void
    {
        v.escapes = escapes;
        v.constant = constant;
        v.accessed = accessed;

        if (constant)
            v.funcRef = funcRef;
    }

    private getBB (): BasicBlock
    {
        if (this.curBB)
            return this.curBB;
        else
            return this.curBB = new BasicBlock(this.nextBBId++);
    }

    private closeBB (): void
    {
        this.curBB = null;
    }

    genClosure(dest: LValue, func: FunctionRef): void
    {
        this.getBB().push(new ClosureOp(dest, func));
    }

    genRet(src: RValue): void
    {
        this.getBB().jump(new RetOp(this.exitLabel, src));
        this.closeBB();
    }
    genGoto(target: Label): void
    {
        this.getBB().jump(new GotoOp(target));
        this.closeBB();
    }
    genIfTrue(value: RValue, onTrue: Label, onFalse: Label): void
    {
        if (isImmediate(value))
            return this.genGoto(isImmediateTrue(value) ? onTrue : onFalse);

        this.getBB().jump(new IfOp(OpCode.IF_TRUE, value, null, onTrue, onFalse));
        this.closeBB();
    }
    genIf(op: OpCode, src1: RValue, src2: RValue, onTrue: Label, onFalse: Label): void
    {
        assert(op >= OpCode._BINCOND_FIRST && op <= OpCode._BINCOND_LAST);

        var folded = foldBinary(op, src1, src2);
        if (folded !== null)
            return this.genGoto(isImmediateTrue(folded) ? onTrue : onFalse);

        this.getBB().jump(new IfOp(op, src1, src2, onTrue, onFalse));
        this.closeBB();
    }

    genLabel(label: Label): void
    {
        assert(!label.bb);

        var bb = this.getBB();
        // If the current basic block is not empty, we must terminate it with a jump to the label
        if (bb.body.length) {
            this.getBB().jump(new GotoOp(label));
            this.closeBB();
            bb = this.getBB();
        }
        bb.placeLabel(label);
    }
    genBinop(op: OpCode, dest: LValue, src1: RValue, src2: RValue): void
    {
        assert(op >= OpCode._BINOP_FIRST && op <= OpCode._BINOP_LAST);
        var folded = foldBinary(op, src1, src2);
        if (folded !== null)
            return this.genAssign(dest, folded);

        // Reorder to make it cleaner. e.g. 'a=a+b' instead of 'a=b+a' and 'a=b+1' instead of 'a=1+b'
        if (isCommutative(op) && (dest === src2 || isImmediate(src1))) {
            var t = src1;
            src1 = src2;
            src2 = t;
        }

        this.getBB().push(new BinOp(op, dest, src1, src2));
    }
    genUnop(op: OpCode, dest: LValue, src: RValue): void
    {
        assert(op >= OpCode._UNOP_FIRST && op <= OpCode._UNOP_LAST);
        var folded = foldUnary(op, src);
        if (folded !== null)
            return this.genAssign(dest, folded);

        this.getBB().push(new UnOp(op, dest, src));
    }
    genAssign(dest: LValue, src: RValue): void
    {
        if (dest === src)
            return;
        this.getBB().push(new AssignOp(dest, src));
    }

    genPropGet(dest: LValue, obj: RValue, propName: RValue): void
    {
        this.getBB().push(new BinOp(OpCode.GET, dest, obj, propName));
    }
    genPropSet(obj: RValue, propName: RValue, src: RValue): void
    {
        this.getBB().push(new PutOp(obj, propName, src));
    }

    genCall(dest: LValue, fref: FunctionRef, closure: RValue, args: RValue[]): void
    {
        if (dest === null)
            dest = nullReg;

        var bb = this.getBB();

        var slots: ArgSlot[] = Array<ArgSlot>(args.length);
        for ( var i = 0, e = args.length; i < e; ++i ) {
            slots[i] = this.getArgSlot(i);
            bb.push(new AssignOp(slots[i], args[i]));
        }

        this.getBB().push(new CallOp(OpCode.CALLIND, dest, null, closure, slots));
    }

    blockList: BasicBlock[] = [];

    close (): void
    {
        if (this.closed)
            return;
        this.closed = true;
        if (this.curBB)
            this.genRet(undefinedValue);
        this.genLabel(this.exitLabel);
        this.exitBB = this.curBB;
        this.closeBB();

        this.blockList = buildBlockList(this.entryBB, this.exitBB);

        if (this.envLevel === 0)
            this.processVars();
    }

    private processVars (): void
    {
        // Allocate locals for the arg slots
        this.argSlots.forEach((a: ArgSlot) => {
            a.local = this.newLocal();
        });

        // Allocate parameter locals
        this.paramSlotsCount = 0;
        this.paramSlots = [];

        this.vars.forEach( (v: Var) => {
            if (!v.escapes && v.accessed) {
                if (v.formalParam) {
                    if (v.constant) {
                        v.param = v.formalParam;
                    } else {
                        v.local = this.newLocal();
                        this.paramSlots.push( v.local );
                        ++this.paramSlotsCount;
                    }
                } else {
                    v.local = this.newLocal();
                }
            }
        });

        // Copy parameters
        var instIndex = 0;
        this.params.forEach((p: Param) => {
            var v = p.variable;
            if (!v.param && v.accessed)
                this.entryBB.insertAt(instIndex++, new AssignOp(v, p));
        });

        // Assign escaping var indexes
        this.envSize = 0;
        this.vars.forEach((v: Var) => {
            if (v.escapes && v.accessed)
                v.envIndex = this.envSize++;
        });

        this.optimizeKnownFuncRefs();

        this.innerFunctions.forEach((ifb: FunctionBuilder) => ifb.processVars());
    }

    /**
     * Change CALLIND to CALL for all known functions.
     */
    private optimizeKnownFuncRefs (): void
    {
        for ( var i = 0, e = this.blockList.length; i < e; ++i )
            scanBlock(this.blockList[i]);

        function scanBlock (bb: BasicBlock): void
        {
            for ( var i = 0, e = bb.body.length; i < e; ++i ) {
                var inst = bb.body[i];
                // Transform CALLIND with a known funcRef into CALL(funcRef)
                //
                if (inst.op === OpCode.CALLIND) {
                    var callInst = <CallOp>inst;

                    var closure: Var;
                    if (closure = isVar(callInst.closure)) {
                        if (closure.funcRef)
                        {
                            callInst.op = OpCode.CALL;
                            callInst.fref = closure.funcRef;
                        }
                    }
                }
            }
        }
    }

    dump (): void
    {
        assert(this.closed);

        this.innerFunctions.forEach((ifb: FunctionBuilder) => {
            ifb.dump();
        });

        function ss (slots: Local[]): string {
            if (!slots || !slots.length)
                return "0";
            return `${slots[0].index}..${slots[slots.length-1].index}`;
        }

        console.log(`\nFUNC_${this.fref.id}://${this.fref.name}`);

        var pslots: string;
        if (!this.paramSlots || !this.paramSlots.length)
            pslots = "0";
        else
            pslots = `${this.paramSlots[0].index}..${this.paramSlots[this.paramSlots.length-1].index}`;
        var aslots: string;
        if (!this.argSlots || !this.argSlots.length)
            aslots = "0";
        else
            aslots = `${this.argSlots[0].local.index}..${this.argSlots[this.argSlots.length-1].local.index}`;

        console.log(`//locals: ${this.locals.length} paramSlots: ${pslots} argSlots: ${aslots} env: ${this.envSize}`);

        for ( var i = 0, e = this.blockList.length; i < e; ++i ) {
            var bb = this.blockList[i];
            console.log(`B${bb.id}:`);
            bb.body.forEach( (inst: Instruction) => {
                console.log(`\t${inst}`);
            });
        }
    }
}

export class ModuleBuilder
{
    nextFunctionId = 0;

    newFunctionRef(name: string): FunctionRef
    {
        return new FunctionRef(this.nextFunctionId++, name);
    }

    newFunctionBuilder(parentBuilder: FunctionBuilder, fref: FunctionRef): FunctionBuilder
    {
        var fb = new FunctionBuilder(this, parentBuilder, fref);
        return fb;
    }
}
