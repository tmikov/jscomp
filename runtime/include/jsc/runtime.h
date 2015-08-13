// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#ifndef JSCOMP_RUNTIME_H
#define JSCOMP_RUNTIME_H

#include "jsc/common.h"
#include "jsc/utf.h"

#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <setjmp.h>
#include <map>
#include <vector>
#include <string>
#include <new>
#include <assert.h>

//#define JS_DEBUG


namespace js
{

struct Env;
struct PropertyAccessor;
struct Memory;
struct Object;
struct NativeObject;
struct Function;
struct StringPrim;
struct String;
struct StackFrame;
struct Runtime;

union RawValue
{
    double nval;
    bool   bval;
    Object * oval;
    Function * fval;
    StringPrim * sval;
    Memory * mval;
};

enum ValueTag
{
    VT_UNDEFINED, VT_NULL, VT_BOOLEAN, VT_NUMBER, VT_ARRAY_HOLE, VT_STRINGPRIM, VT_MEMORY, VT_OBJECT,
    _VT_SHIFT = 3,
};

inline bool isValueTagPointer (unsigned t)
{
    return t >= VT_STRINGPRIM;
}
inline bool isValueTagPrimitive (unsigned t)
{
    return t <= VT_STRINGPRIM;
}
inline bool isValueTagObject (unsigned t)
{
    return t == VT_OBJECT;
}

struct TaggedValue
{
    unsigned tag;
    RawValue raw;
};

Memory * allocate (size_t size, StackFrame * caller);

void forceGC (StackFrame * caller);

void _release (Memory * p, Runtime * runtime);

#define JS_UNDEFINED_VALUE  js::TaggedValue{js::VT_UNDEFINED}
#define JS_NULL_VALUE       js::TaggedValue{js::VT_NULL}

struct IMark
{
    virtual bool _mark (const Memory *) = 0;
};

struct Memory
{
    enum : uintptr_t
    {
        FLAGS_MASK = 0x01, MARK_BIT_MASK = 0x01
    };

    mutable uintptr_t header; //< used by GC
    unsigned gcSize;

    Memory * getNext () const
    {
        return (Memory *)(header & ~FLAGS_MASK);
    }

    void setNext (Memory * next)
    {
        header = (uintptr_t)next | (header & FLAGS_MASK);
    }

    virtual bool mark (IMark * marker, unsigned markBit) const = 0;

    virtual void finalizer ();

    virtual ~Memory ();

    static void * operator new (size_t size, StackFrame * caller)
    { return allocate(size, caller); }

    static void * operator new (size_t, StackFrame * caller, size_t actualSize)
    { return allocate(actualSize, caller); }
    //static void operator delete ( void * p, Runtime * runtime )     { _release( (Memory *)p, runtime ); }
};

struct Env : public Memory
{
    Env * parent;
    unsigned size;
    TaggedValue vars[];

    Env () {};

    virtual bool mark (IMark * marker, unsigned markBit) const;

    static Env * make (StackFrame * caller, Env * parent, unsigned size);

    TaggedValue * var (unsigned index)
    { return vars + index; }

    TaggedValue * var (unsigned level, unsigned index);
};

enum PropAttr
{
    PROP_NONE = 0x00,
    PROP_ENUMERABLE = 0x01, PROP_WRITEABLE = 0x02, PROP_CONFIGURABLE = 0x04, PROP_GET_SET = 0x08,
    PROP_NORMAL = PROP_ENUMERABLE | PROP_WRITEABLE | PROP_CONFIGURABLE
};

struct ListEntry
{
    ListEntry * prev, * next;

    inline void init ()
    {
        this->prev = this->next = this;
    }

    inline void remove ()
    {
        this->prev->next = this->next;
        this->next->prev = this->prev;
    }

    inline void insertAfter (ListEntry * entry)
    {
        entry->prev = this;
        entry->next = this->next;
        this->next->prev = entry;
        this->next = entry;
    }

    inline void insertBefore (ListEntry * entry)
    {
        entry->next = this;
        entry->prev = this->prev;
        this->prev->next = entry;
        this->prev = entry;
    }
};

struct Property : public ListEntry
{
    const StringPrim * const name;
    unsigned flags;
    TaggedValue value;

    Property (const StringPrim * name, unsigned flags, TaggedValue value) :
        name(name), flags(flags), value(value)
    {}
};

struct less_cstr {
    bool operator() (const char * a, const char * b) const {
        return a != b && strcmp(a, b) < 0;
    }
};

enum ObjectFlags
{
    OF_NOEXTEND = 1,  // New properties cannot be added
    OF_NOCONFIG = 2,  // properties cannot be configured or deleted
    OF_NOWRITE  = 4,  // property values cannot be modified

    OF_INDEX_PROPERTIES = 8, // Index-like properties (e.g. "0", "1", etc) have been defined using defineOwnProperty
};

struct Object : public Memory
{
    unsigned flags;
    Object * parent;
    std::map<const char *, Property, less_cstr> props;
    ListEntry propList; // We need to be able to enumerate properties in insertion order

    Object (Object * parent) :
        flags(0),
        parent(parent)
    {
        this->propList.init();
    }

    inline void init (StackFrame *) {}

    virtual Object * createDescendant (StackFrame * caller);

    virtual bool mark (IMark * marker, unsigned markBit) const;

    Object * defineOwnProperty (
        StackFrame * caller, const StringPrim * name, unsigned flags, TaggedValue value = JS_UNDEFINED_VALUE
    );

    Property * getOwnProperty (const StringPrim * name);
    Property * getProperty (const StringPrim * name, Object ** propObj);
    bool hasOwnProperty (const StringPrim * name)
    {
        return getOwnProperty(name) != NULL;
    }
    bool hasProperty (const StringPrim * name);
    TaggedValue getPropertyValue (StackFrame * caller, Property * p);

    /**
     * Update a property value, bit only if the property has a setter, or if the property is in 'this'
     * object. Otherwise, we have to insert a new property in this object.
     *
     * <p>If the property is read-only, throw an error or ignore the write (depending in "strict
     * mode" setting.
     *
     * @return 'true' if the value was updated. 'false' if the caller needs to insert a new property
     *   in 'this'
     */
    bool updatePropertyValue (StackFrame * caller, Object * propObj, Property * p, TaggedValue v);

    TaggedValue get (StackFrame * caller, const StringPrim * name);
    void put (StackFrame * caller, const StringPrim * name, TaggedValue v);
    virtual bool hasComputed (StackFrame * caller, TaggedValue propName);
    virtual TaggedValue getComputed (StackFrame * caller, TaggedValue propName);
    virtual void putComputed (StackFrame * caller, TaggedValue propName, TaggedValue v);

    bool deleteProperty (StackFrame * caller, const StringPrim * name);
    virtual bool deleteComputed (StackFrame * caller, TaggedValue propName);

    TaggedValue getParentValue() const;

    void freeze ()
    {
        this->flags |= OF_NOEXTEND | OF_NOCONFIG | OF_NOWRITE;
    }
    void seal ()
    {
        this->flags |= OF_NOEXTEND | OF_NOCONFIG;
    }
    void preventExtensions ()
    {
        this->flags |= OF_NOEXTEND;
    }

    virtual TaggedValue defaultValue (StackFrame * caller, ValueTag preferredType);

};

template<class BASE, class TOCREATE>
struct PrototypeCreator : public BASE
{
    PrototypeCreator (Object * parent): BASE(parent) {}

    virtual Object * createDescendant (StackFrame * caller);
};


struct PropertyAccessor : public Memory
{
    Function * get;
    Function * set;

    PropertyAccessor (Function * get, Function * set) :
        get(get), set(set)
    { }

    virtual bool mark (IMark * marker, unsigned markBit) const;
};

typedef void (*NativeFinalizerFn)(NativeObject*);

struct NativeObject : public Object
{
    NativeFinalizerFn nativeFinalizer;
    unsigned const internalCount;
    uintptr_t internalProps[1];

    static NativeObject * make (StackFrame * caller, Object * parent, unsigned internalPropCount);
    static NativeObject * make (StackFrame * caller, unsigned internalPropCount);

    virtual Object * createDescendant (StackFrame * caller);
    virtual ~NativeObject ();

    void setNativeFinalizer (NativeFinalizerFn finalizer)
    {
        this->nativeFinalizer = finalizer;
    }

    inline uintptr_t getInternal (unsigned index) const
    {
        assert(index < this->internalCount);
        return this->internalProps[index];
    }

    inline void setInternal (unsigned index, uintptr_t value)
    {
        assert(index < this->internalCount);
        this->internalProps[index] = value;
    }

private:
    NativeObject (Object * parent, unsigned internalCount);
};

class IndexedObject : public Object
{
    typedef Object super;
public:
    IndexedObject (Object * parent) :
        Object(parent)
    {}

    virtual bool hasComputed (StackFrame * caller, TaggedValue propName);
    virtual TaggedValue getComputed (StackFrame * caller, TaggedValue propName);
    virtual void putComputed (StackFrame * caller, TaggedValue propName, TaggedValue v);
    virtual bool deleteComputed (StackFrame * caller, TaggedValue propName);

    virtual bool hasIndex (uint32_t index) const = 0;
    virtual TaggedValue getAtIndex (StackFrame * caller, uint32_t index) const = 0;
    virtual bool setAtIndex (uint32_t index, TaggedValue value) = 0;
    virtual bool deleteAtIndex (uint32_t index) = 0;
};

class ArrayBase : public IndexedObject
{
    typedef IndexedObject super;
public:
    std::vector<TaggedValue> elems;

    ArrayBase (Object * parent):
        IndexedObject(parent)
    {}

    virtual bool mark (IMark * marker, unsigned markBit) const;

    unsigned getLength () const { return elems.size(); }

    void setLength (unsigned newLen);

    bool hasElem (unsigned index) const
    {
        return index < elems.size() && elems[index].tag != VT_ARRAY_HOLE;
    }

    TaggedValue getElem (unsigned index) const
    {
        if (index < elems.size()) {
            const TaggedValue * pe = &elems[index];
            if (pe->tag != VT_ARRAY_HOLE)
                return *pe;
        }
        return JS_UNDEFINED_VALUE;
    }
    void setElem (unsigned index, TaggedValue v);

    virtual bool hasIndex (uint32_t index) const;
    virtual TaggedValue getAtIndex (StackFrame * caller, uint32_t index) const;
    virtual bool setAtIndex (uint32_t index, TaggedValue value);
    virtual bool deleteAtIndex (uint32_t index);
};

class Array : public ArrayBase
{
    typedef ArrayBase super;
public:
    Array (Object * parent):
        ArrayBase(parent)
    {}

    void init (StackFrame * caller);

    static Array * findArrayInstance (StackFrame * caller, TaggedValue thisp);
    static TaggedValue lengthGetter (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * argv);
    static TaggedValue lengthSetter (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * argv);
};

class Arguments : public ArrayBase
{
    typedef ArrayBase super;
public:
    Arguments (Object * parent):
        ArrayBase(parent)
    {}

    void init (StackFrame * caller, int argc, const TaggedValue * argv);
};

struct ForInIterator : public Memory
{
    typedef std::vector<const StringPrim *>::const_iterator NameIterator;

    /** The object we are enumerating */
    Object * m_obj;
    /** If the object is an array, type-safe pointer to it */
    ArrayBase * m_array;
    /** If the object is a string, type-safe pointer to it */
    String * m_string;
    /** The property names to be enumerated */
    std::vector<const StringPrim *> m_propNames;
    /* If an array, the next index to be enumerated */
    unsigned m_curIndex;
    /* The next property to be enumerated */
    NameIterator m_curName;

    static void make (StackFrame * caller, TaggedValue * result, Object * obj);

    virtual bool mark (IMark * marker, unsigned markBit) const;
    bool next (StackFrame * caller, TaggedValue * result);

private:
    ForInIterator ():
        m_obj(NULL),
        m_array(NULL)
    {}

    void init (StackFrame * caller, Object * obj);
};

typedef TaggedValue (* CodePtr) (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * args);

class Function : public Object
{
    typedef Object super;
public:
    Env * env;
    unsigned length; //< number of argumenrs
    CodePtr code;
    CodePtr consCode;

    Function (Object * parent):
        Object(parent), env(NULL), length(0), code(NULL)
    {}
    void init (StackFrame * caller, Env * env, CodePtr code, CodePtr consCode, const StringPrim * name, unsigned length);

    virtual bool mark (IMark * marker, unsigned markBit) const;

    /** Define the 'prototype' property */
    void definePrototype (StackFrame * caller, Object * prototype, unsigned propsFlags = 0);

    bool hasInstance (StackFrame * caller, Object * inst);

    virtual TaggedValue call (StackFrame * caller, unsigned argc, const TaggedValue * argv);
    virtual TaggedValue callCons (StackFrame * caller, unsigned argc, const TaggedValue * argv);
};

struct FunctionCreator : public Function
{
    FunctionCreator (Object * parent) :
        Function(parent)
    {}

    virtual Object * createDescendant (StackFrame * caller);
};

class BoundFunction : public Function
{
    typedef Function super;
public:
    Function * const target;
    unsigned const boundCount;
    std::vector<TaggedValue> boundArgs;

    BoundFunction (Object * parent, Function * aTarget, unsigned argc, const TaggedValue * argv) :
        Function(parent),
        target(aTarget),
        boundCount(argc),
        boundArgs(&argv[0], &argv[argc])
    {}

    virtual bool mark (IMark * marker, unsigned markBit) const;

    virtual TaggedValue call (StackFrame * caller, unsigned argc, const TaggedValue * argv);
    virtual TaggedValue callCons (StackFrame * caller, unsigned argc, const TaggedValue * argv);
};

/**
 * This object creates a descendant based on the prototype of the target function instead of itself
 */
struct BoundPrototype : public Object
{
    Function * const target;

    BoundPrototype (Object * parent, Function * aTarget) :
        Object(parent), target(aTarget)
    {}

    virtual Object * createDescendant (StackFrame * caller);
};

struct StringPrim : public Memory
{
    enum {
        F_INTERNED = 1,
        F_PERMANENT = 2,
    };
    mutable unsigned stringFlags;
    const unsigned byteLength;
    unsigned charLength;
    mutable unsigned lastPos;
    mutable unsigned lastIndex;
    //private:
    unsigned char _str[];

    StringPrim (unsigned byteLength) :
        byteLength(byteLength)
    {
        this->stringFlags = 0;
        this->_str[byteLength] = 0;
        this->lastPos = 0;
        this->lastIndex = 0;
#ifdef JS_DEBUG
        this->charLength = ~0u; // for debugging to show uninitialized
#endif
    }

    void init ()
    {
        this->charLength = lengthInUTF16Units((const unsigned char *)_str, (const unsigned char *)_str + byteLength);
    }
    void init (unsigned charLength)
    {
        this->charLength = charLength;
    }

    //public:
    bool mark (IMark * marker, unsigned markBit) const;

    static StringPrim * makeEmpty (StackFrame * caller, unsigned length);
    static StringPrim * make (StackFrame * caller, const char * str, unsigned length, unsigned charLength);
    static StringPrim * make (StackFrame * caller, const char * str, unsigned length);

    static StringPrim * make (StackFrame * caller, const char * str)
    {
        return make(caller, str, (unsigned)strlen(str));
    }

    bool isInterned () const { return (this->stringFlags & F_INTERNED) != 0; }

    const char * getStr () const
    {
        return (const char *)this->_str;
    }

    /**
     * Find the position of a character from a valid index.
     *
     * @param index
     * @param secondSurrogate set to true if the position is the second surrogate of the pair
     */
    const unsigned char * charPos (uint32_t index, bool * secondSurrogate) const;
    TaggedValue charCodeAt (uint32_t index) const;
    TaggedValue charAt (StackFrame * caller, uint32_t index) const;
    /**
     * Extract a substring.
     *
     * @param from - start utf16 index. It is clamped at charLength
     * @param to - end (exclusive) utf16 index. It is clamped at charLength
     */
    TaggedValue substring (StackFrame * caller, uint32_t from, uint32_t to) const;

    /**
     * Extract a substring using byte offset.
     *
     * @param from - start offset in bytes. Clamped at byteLength
     * @param to - end offset in bytes
     */
    TaggedValue byteSubstring (StackFrame * caller, uint32_t from, uint32_t to) const;

    static unsigned lengthInUTF16Units (const unsigned char * from, const unsigned char * to);
};

struct less_StringPrim {
    bool operator() (const StringPrim * a, const StringPrim * b) const {
        return a != b && strcmp(a->getStr(), b->getStr()) < 0;
    }
};

class Box : public Object
{
    typedef Object super;
public:
    TaggedValue value;

    Box (Object * parent, TaggedValue value = JS_UNDEFINED_VALUE) :
        Object(parent), value(value)
    {}

    void setValue ( TaggedValue value )
    {
        this->value = value;
    }

    bool mark (IMark * marker, unsigned markBit) const;
    virtual TaggedValue defaultValue (StackFrame * caller, ValueTag preferredType);
};

typedef Box Number;
typedef Box Boolean;

class String : public IndexedObject
{
    typedef IndexedObject super;
public:
    TaggedValue value;

    String (Object * parent, TaggedValue value = JS_UNDEFINED_VALUE) :
        IndexedObject(parent), value(value)
    {}

    const StringPrim * getStrPrim () const
    {
        return this->value.raw.sval;
    }

    void setValue ( TaggedValue value )
    {
        this->value = value;
    }

    bool mark (IMark * marker, unsigned markBit) const;
    virtual TaggedValue defaultValue (StackFrame * caller, ValueTag preferredType);

    virtual bool hasIndex (uint32_t index) const;
    virtual TaggedValue getAtIndex (StackFrame * caller, uint32_t index) const;
    virtual bool setAtIndex (uint32_t index, TaggedValue value);
    virtual bool deleteAtIndex (uint32_t index);
};

struct Error : public Object
{
    Error (Object * parent):
        Object(parent)
    {}
};

struct StackFrame
{
    //Runtime * runtime;
    StackFrame * caller;
    Env * escaped;
#ifdef JS_DEBUG
    const char * fileFunc;
    unsigned line;
#endif
    unsigned localCount;
    TaggedValue locals[0];

    StackFrame (/*Runtime * runtime, */StackFrame * caller, Env * env, unsigned escapedCount, unsigned localCount,
                unsigned skipInit
#ifdef JS_DEBUG
        , const char * fileFunc, unsigned line
#endif
    )
    {
        this->caller = caller;
        //this->runtime = runtime;
        this->escaped = escapedCount ? Env::make(caller, env, escapedCount) : NULL;
#ifdef JS_DEBUG
        this->fileFunc = fileFunc;
        this->line = line;
#endif
        this->localCount = localCount;
        memset(locals, 0, sizeof(locals[0]) * (localCount - skipInit));
    }

    bool mark (IMark * marker, unsigned markBit) const;

    TaggedValue * var (unsigned index)
    { return locals + index; }

    const char * getFileFunc () const
    {
#ifdef JS_DEBUG
        return fileFunc;
#else
        return NULL;
#endif
    }

    unsigned getLine () const
    {
#ifdef JS_DEBUG
        return line;
#else
        return 0;
#endif
    }

    void setLine (unsigned line)
    {
#ifdef JS_DEBUG
        this->line = line;
#else
        (void)line;
#endif
    }

    void printStackTrace ();
};

template<unsigned E, unsigned L, unsigned SkipInit>
struct StackFrameN : public StackFrame
{
    TaggedValue _actualLocals[L];

/*    StackFrameN (Runtime * runtime, StackFrame * caller, Env * env, const char * fileFunc, unsigned line) :
#ifdef JS_DEBUG
        StackFrame(runtime, caller, env, E, L, SkipInit, fileFunc, line)
#else
        StackFrame( runtime, caller, env, E, L, SkipInit )
#endif
    { }*/

    StackFrameN (StackFrame * caller, Env * env, const char * fileFunc, unsigned line) :
#ifdef JS_DEBUG
        StackFrame(/*caller->runtime, */caller, env, E, L, SkipInit, fileFunc, line)
#else
        StackFrame(caller, env, E, L, SkipInit)
#endif
    { }
};

struct TryRecord
{
    TryRecord * prev;
    jmp_buf jbuf;
};

struct Runtime
{
    enum
    {
        DIAG_HEAP_ALLOC = 0x01, DIAG_HEAP_ALLOC_STACK = 0x02, DIAG_HEAP_GC = 0x04, DIAG_HEAP_GC_VERBOSE = 0x08,
        DIAG_ALL = 0x0F,
        DIAG_FORCE_GC = 0x10,
    };
    unsigned diagFlags;
    bool strictMode;

    TaggedValue strictThrowerAccessor;
    TaggedValue arrayLengthAccessor;

    Object * objectPrototype;
    Function * functionPrototype;
    Function * object;
    Function * function;

    Object * stringPrototype;
    Function * string;
    Object * numberPrototype;
    Function * number;
    Object * booleanPrototype;
    Function * boolean;
    Object * arrayPrototype;
    Function * array;
    Object * errorPrototype;
    Function * error;
    Object * typeErrorPrototype;
    Function * typeError;

    Env * env;

    typedef std::pair<unsigned,const unsigned char*> PasStr;

    struct less_PasStr {
        bool operator() (const PasStr & a, const PasStr & b) const;
    };

    std::map<PasStr,const StringPrim*,less_PasStr> permStrings;

    const StringPrim * permStrEmpty;
    const StringPrim * permStrUndefined;
    const StringPrim * permStrNull;
    const StringPrim * permStrTrue;
    const StringPrim * permStrFalse;
    const StringPrim * permStrNaN;
    const StringPrim * permStrPrototype;
    const StringPrim * permStrConstructor;
    const StringPrim * permStrLength;
    const StringPrim * permStrName;
    const StringPrim * permStrArguments;
    const StringPrim * permStrCaller;
    const StringPrim * permStrCallee;
    const StringPrim * permStrObject;
    const StringPrim * permStrBoolean;
    const StringPrim * permStrNumber;
    const StringPrim * permStrString;
    const StringPrim * permStrFunction;
    const StringPrim * permStrToString;
    const StringPrim * permStrValueOf;
    const StringPrim * permStrMessage;
    const StringPrim * permStrUnicodeReplacementChar;

    // Pre-allocated ASCII chars for faster substring/charAt/[] in the common case
    enum { CACHED_CHARS = 128 };
    const StringPrim * asciiChars[CACHED_CHARS];

    unsigned markBit; // the value that was used for marking during the previous collection

    struct MemoryHead : public Memory
    {
        virtual bool mark (IMark * marker, unsigned markBit) const;
    };

    MemoryHead head;
    Memory * tail;
    unsigned allocatedSize;
    unsigned gcThreshold;

    TryRecord * tryRecord = NULL;
    TaggedValue thrownObject = JS_UNDEFINED_VALUE;

    Runtime (bool strictMode);

    bool mark (IMark * marker, unsigned markBit);

    const StringPrim * findInterned (const StringPrim * str);
    const StringPrim * internString (StackFrame * caller, bool permanent, const char * str, unsigned len);
    const StringPrim * internString (StackFrame * caller, bool permanent, const char * str);
    const StringPrim * internString (const StringPrim * str);
    void uninternString (StringPrim * str);
    void initStrings (StackFrame * caller, const StringPrim ** prims, const char * strconst, const unsigned * offsets, unsigned count);


    void pushTry (TryRecord * tryRec)
    {
        tryRec->prev = this->tryRecord;
        this->tryRecord = tryRec;
    }

    void popTry (TryRecord * toPop)
    {
        assert(this->tryRecord == toPop);
        this->tryRecord = this->tryRecord->prev;
    }

private:
    void parseDiagEnvironment();

    void systemConstructor (
        StackFrame * caller, unsigned envIndex, Object * prototype, CodePtr consCode, CodePtr code,
        const char * name, unsigned length,
        Object ** outPrototype, Function ** outConstructor
    );

    void defineMethod (StackFrame * caller, Object * prototype, const char * sname, unsigned length, CodePtr code);
};

extern Runtime * g_runtime;

#ifdef JS_DEBUG
inline Runtime * getRuntime (StackFrame * frame) { return g_runtime; }
#define JS_GET_RUNTIME(frame)  js::getRuntime(frame)
#else
#define JS_GET_RUNTIME(frame)  js::g_runtime
#endif

#define JS_IS_STRICT_MODE(frame) (JS_GET_RUNTIME(frame)->strictMode != false)

TaggedValue emptyFunc (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue objectFunction (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue objectConstructor (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue functionFunction (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue functionConstructor (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue stringFunction (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue stringConstructor (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue stringCharCodeAt (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv);
TaggedValue stringCharAt (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv);
TaggedValue stringSlice (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv);
TaggedValue numberFunction (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue numberConstructor (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue booleanFunction (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue booleanConstructor (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue arrayFunction (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue arrayConstructor (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue errorFunction (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv);
TaggedValue errorConstructor (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv);
TaggedValue typeErrorFunction (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv);
TaggedValue typeErrorConstructor (StackFrame * caller, Env *, unsigned argc, const TaggedValue * argv);

inline bool markValue (IMark * marker, unsigned markBit, const TaggedValue & value)
{
    if (isValueTagPointer(value.tag) && (value.raw.mval->header & Memory::MARK_BIT_MASK) != markBit)
        return marker->_mark(value.raw.oval);
    else
        return true;
}

inline bool markMemory (IMark * marker, unsigned markBit, const Memory * mem)
{
    if (mem && (mem->header & Memory::MARK_BIT_MASK) != markBit)
        return marker->_mark(mem);
    else
        return true;
}

inline TaggedValue makeBooleanValue (bool bval)
{
    TaggedValue val;
    val.tag = VT_BOOLEAN;
    val.raw.bval = bval;
    return val;
}

inline TaggedValue makeNumberValue (double dval)
{
    TaggedValue val;
    val.tag = VT_NUMBER;
    val.raw.nval = dval;
    return val;
}

inline TaggedValue makeMemoryValue (ValueTag tag, Memory * m)
{
    TaggedValue val;
    val.tag = tag;
    val.raw.mval = m;
    return val;
}

inline TaggedValue makePropertyAccessorValue (PropertyAccessor * pr)
{
    return makeMemoryValue(VT_MEMORY, pr);
}

inline TaggedValue makeObjectValue (Object * o)
{
    return makeMemoryValue(VT_OBJECT, o);
}

inline TaggedValue makeStringValue (const StringPrim * s)
{
    return makeMemoryValue(VT_STRINGPRIM, const_cast<StringPrim*>(s));
}

inline TaggedValue makeStringValue (StackFrame * caller, const char * str)
{
    return makeStringValue(StringPrim::make(caller, str));
}

inline TaggedValue makeInternStringValue (StackFrame * caller, const char * str, bool permanent)
{
    return makeStringValue(JS_GET_RUNTIME(caller)->internString(caller, permanent, str));
}

Object * objectCreate (StackFrame * caller, TaggedValue parent);
TaggedValue newFunction (StackFrame * caller, Env * env, const StringPrim * name, unsigned length, CodePtr code);

void throwValue (StackFrame * caller, TaggedValue val) JS_NORETURN;
void throwOutOfMemory (StackFrame * caller) JS_NORETURN;
void throwTypeError (StackFrame * caller, const char * str, ...) JS_NORETURN;

inline Function * isFunction (TaggedValue v)
{
    return isValueTagObject(v.tag) ? dynamic_cast<Function *>(v.raw.oval) : NULL;
}
inline Function * isCallable (TaggedValue v)
{
    return isValueTagObject(v.tag) ? dynamic_cast<Function *>(v.raw.oval) : NULL;
}
TaggedValue call(StackFrame * caller, TaggedValue value, unsigned argc, const TaggedValue * argv);
TaggedValue callCons(StackFrame * caller, TaggedValue value, unsigned argc, const TaggedValue * argv);

/**
 * Checks whether the ToString(ToUint32(val)) === ToString(val) && val != 2**32-1.
 */
inline bool isValidArrayIndexNumber (TaggedValue val, uint32_t * index)
{
    if (val.tag == VT_NUMBER) {
        uint32_t n = (uint32_t)val.raw.nval;
        if (n == val.raw.nval && n != UINT32_MAX) {
            *index = n;
            return true;
        }
    }
    return false;
}

bool isIndexString (const char * str, uint32_t * index);

void put (StackFrame * caller, TaggedValue obj, const StringPrim * propName, TaggedValue val);
void putComputed (StackFrame * caller, TaggedValue obj, TaggedValue propName, TaggedValue val);
TaggedValue get (StackFrame * caller, TaggedValue obj, const StringPrim * propName);
TaggedValue getComputed (StackFrame * caller, TaggedValue obj, TaggedValue propName);

bool toBoolean (TaggedValue v);
Object * toObject (StackFrame * caller, TaggedValue v);

TaggedValue toPrimitive (StackFrame * caller, TaggedValue v, ValueTag preferredType = (ValueTag)0);
double toNumber (const StringPrim * str);
double toNumber (StackFrame * caller, TaggedValue v);
double primToNumber (TaggedValue v);
double toInteger (double n);
inline double toInteger (StackFrame * caller, TaggedValue v)
{
    return toInteger(toNumber(caller, v));
}
uint32_t toUint32 (StackFrame * caller, TaggedValue v);
int32_t toInt32 (StackFrame * caller, TaggedValue v);
inline uint32_t toUint32 (double num)
{
    return isfinite(num) ? (uint32_t)num : 0;
}
inline int32_t toInt32 (double num)
{
    return isfinite(num) ? (int32_t)num : 0;
}
TaggedValue toString (StackFrame * caller, double n);
TaggedValue toString (StackFrame * caller, TaggedValue v);

TaggedValue concatString (StackFrame * caller, StringPrim * a, StringPrim * b);
bool less (const StringPrim * a, const StringPrim * b);
bool equal (const StringPrim * a, const StringPrim * b);

// Operators
TaggedValue operator_ADD (StackFrame * caller, TaggedValue a, TaggedValue b);

const StringPrim * operator_TYPEOF (StackFrame * caller, TaggedValue a);

bool operator_IF_STRICT_EQ (TaggedValue a, TaggedValue b);
bool operator_IF_LOOSE_EQ (StackFrame * caller, TaggedValue a, TaggedValue b);
bool operator_IF_LT (StackFrame * caller, TaggedValue x, TaggedValue y);
bool operator_IF_LE (StackFrame * caller, TaggedValue x, TaggedValue y);
bool operator_IF_GT (StackFrame * caller, TaggedValue x, TaggedValue y);
bool operator_IF_GE (StackFrame * caller, TaggedValue x, TaggedValue y);

inline bool operator_IF_INSTANCEOF (StackFrame * caller, TaggedValue x, Function * y)
{
    return isValueTagObject(x.tag) && y->hasInstance(caller, x.raw.oval);
}

inline Property * Object::getOwnProperty (const StringPrim * name)
{
    auto it = this->props.find(name->getStr());
    return it != this->props.end() ? &it->second : NULL;
}

inline TaggedValue Object::getPropertyValue (StackFrame * caller, Property * p)
{
    if ((p->flags & PROP_GET_SET) == 0) {
        return p->value;
    } else {
        // Invoke the getter
        if (Function * getter = ((PropertyAccessor *)p->value.raw.oval)->get) {
            TaggedValue thisp = makeObjectValue(this);
            return (*getter->code)(caller, getter->env, 1, &thisp);
        }
    }
    return JS_UNDEFINED_VALUE;
}

inline TaggedValue Object::getParentValue () const
{
    return this->parent ? makeObjectValue(this->parent) : JS_NULL_VALUE;
}

template<class T>
inline T * newInit (StackFrame * caller, TaggedValue * holder, Object * parent)
{
    T * obj = new (caller) T(parent);
    *holder = makeObjectValue(obj);
    obj->init(caller);
    return obj;
}

template<class T>
inline T * newInit (StackFrame * caller, Object * parent)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ "newInit()", __LINE__);
    return newInit<T>(&frame, &frame.locals[0], parent);
}

template<class T, class P1>
inline T * newInit2 (StackFrame * caller, TaggedValue * holder, Object * parent, P1 p1)
{
    T * obj = new (caller) T(parent, p1);
    *holder = makeObjectValue(obj);
    obj->init(caller);
    return obj;
}

template<class T, class P1>
inline T * newInit2 (StackFrame * caller, Object * parent, P1 p1)
{
    StackFrameN<0,1,0> frame(caller, NULL, __FILE__ "newInit2()", __LINE__);
    return newInit2<T>(&frame, &frame.locals[0], parent, p1);
}

template<class BASE, class TOCREATE>
Object * PrototypeCreator<BASE,TOCREATE>::createDescendant (StackFrame * caller)
{
    return newInit<TOCREATE>(caller, this);
};

}; // namespace js

#endif //JSCOMP_RUNTIME_H
