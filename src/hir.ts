// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/// <reference path="../typings/tsd.d.ts" />

import assert = require("assert");
import util = require("util");

export class MemValue
{
}

export class LValue extends MemValue
{
}

export class Regex
{
    constructor (public pattern: string, public flags: string) {}
    toString(): string { return `Regex(/${this.pattern}/${this.flags})`; }
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
    constructor(public name: string, public index: number) {super();}
    toString() { return `Param(${this.index},${this.name})`; }
}

export class Var extends LValue
{
    constructor(public name: string, public id: number) {super();}
    toString() { return `Var(${this.id},${this.name})`; }
}

export class Local extends LValue
{
    isTemp: boolean = false; // for users of the module. Has no meaning internally

    constructor(public id: number) {super();}
    toString() { return `Local(${this.id})`; }
}

export var nullValue = new SpecialConstantClass("null");
export var undefinedValue = new SpecialConstantClass("undefined");

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

    // Unconditional jumps
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
    _JUMP_FIRST = GOTO,
    _JUMP_LAST = IF_LE,
}

var g_opcodeName: string[] = [
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

    // Unconditional jumps
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

class JumpInstruction extends Instruction {
    constructor (op: OpCode, public label1: Label, public label2: Label)  { super(op); }
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


function uwrapImmedate (v: RValue): any
{
    if (v === nullValue)
        return null;
    else if (v === undefinedValue)
        return void 0;
    else
        return v;
}

function wrapImmediate (v: any): RValue
{
    if (v === void 0)
        return undefinedValue;
    else if (v === null)
        return nullValue;
    else
        return v;
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

export class FunctionBuilder
{
    id: number;
    name: string;

    params: Param[] = [];

    nextParamIndex = 0;
    nextVarId = 0;
    nextLocalId = 0;
    nextLabelId = 0;
    nextBBId = 0;

    entryBB: BasicBlock = null;
    curBB: BasicBlock = null;

    constructor(id: number, name: string)
    {
        this.id = id;
        this.name = name;
        this.entryBB = this.getBB();
    }
    toString() { return `Function(${this.id},${this.name})`; }

    newParam(name: string): Param
    {
        var param = new Param(name, this.nextParamIndex++);
        this.params.push(param);
        return param;
    }

    newVar(name: string): Var
    {
        var v = new Var(name, this.nextVarId++);
        return v;
    }

    newLocal(): Local
    {
        var loc = new Local(this.nextLocalId++);
        return loc;
    }

    newLabel(): Label
    {
        var lab = new Label(this.nextLabelId++);
        return lab;
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

    genClosure(dest: LValue, func: FunctionBuilder): void
    {
        assert(false);
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
            var t = dest;
            dest = src2;
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

    genPropGet(dest: LValue, obj: RValue, propName: string): void
    {
        assert(false);
    }
    genPropSet(obj: RValue, propName: string, src: RValue): void
    {
        assert(false);
    }
    genComputedPropGet(dest: LValue, obj: RValue, prop: RValue): void
    {
        assert(false);
    }
    genComputedPropSet(obj: RValue, prop: RValue, src: RValue): void
    {
        assert(false);
    }

    genCall(dest: LValue, closure: RValue, args: RValue[]): void
    {
        assert(false);
    }


    log (): void
    {
        var visited: boolean[] = [];
        var queue: BasicBlock[] = [];

        var enque = (bb: BasicBlock) => {
            if (!visited[bb.id]) {
                visited[bb.id] = true;
                queue.push(bb);
            }
        };
        var visit = (bb: BasicBlock) => {
            console.log(`B${bb.id}:`);
            bb.body.forEach( (inst: Instruction) => {
                console.log(`\t${inst}`);
            });
            bb.succ.forEach( (lab: Label) => {
                enque(lab.bb);
            });
        };

        enque(this.entryBB);
        while (queue.length)
            visit( queue.shift() );
    }
}

export class ModuleBuilder
{
    nextFunctionId = 0;

    newFunction(name: string): FunctionBuilder
    {
        var fb = new FunctionBuilder(this.nextFunctionId++, name);
        console.log(`new ${fb}`);
        return fb;
    }
}
