// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <map>
#include <vector>
#include <string>
#include <new>

//#define JS_DEBUG

#define JS_NORETURN __attribute__((noreturn))
#define JS_LIKELY(cond)          __builtin_expect(!!(cond), 1)
#define JS_UNLIKELY(cond)        __builtin_expect(!!(cond), 0)

namespace js
{

struct Env;
struct PropertyAccessor;
struct Memory;
struct Object;
struct Function;
struct StringPrim;
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
    VT_UNDEFINED, VT_NULL, VT_BOOLEAN, VT_NUMBER, VT_STRINGPRIM, VT_MEMORY, VT_OBJECT, VT_FUNCTION,
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
    return t >= VT_OBJECT;
}
inline bool isValueTagFunction (unsigned t)
{
    return t == VT_FUNCTION;
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
    PROP_ENUMERABLE = 0x01, PROP_WRITEABLE = 0x02, PROP_CONFIGURABLE = 0x04, PROP_GET_SET = 0x08,
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
        return strcmp(a, b) < 0;
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

    virtual Object * createDescendant (StackFrame * caller);

    virtual bool mark (IMark * marker, unsigned markBit) const;

    Object * defineOwnProperty (
        StackFrame * caller, const StringPrim * name, unsigned flags,
        TaggedValue value = JS_UNDEFINED_VALUE, Function * get = NULL, Function * set = NULL
    );

    Property * getOwnProperty (const StringPrim * name);
    Property * getProperty (const StringPrim * name, Object ** propObj);
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
    virtual TaggedValue getComputed (StackFrame * caller, TaggedValue propName);
    virtual void putComputed (StackFrame * caller, TaggedValue propName, TaggedValue v);

    bool deleteProperty (StackFrame * caller, const char * name);

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
    virtual bool isCallable () const;
    virtual TaggedValue call (StackFrame * caller, unsigned argc, const TaggedValue * argv);

    static bool isIndexString (const char * str, uint32_t * index);
};

template<class BASE, class TOCREATE>
struct PrototypeCreator : public BASE
{
    PrototypeCreator (Object * parent): BASE(parent) {}

    virtual Object * createDescendant (StackFrame * caller)
    {
        return new (caller) TOCREATE(this);
    }
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

/*struct Arguments : public Object
{
    std::vector<TaggedValue> elems;
    unsigned length;
    // TODO: array-line functionality
    virtual TaggedValue getComputed (StackFrame * caller, TaggedValue propName);
    virtual void putComputed (StackFrame * caller, TaggedValue propName, TaggedValue v);
};*/

struct ArrayBase : public Object
{
    std::vector<TaggedValue> elems;

    ArrayBase (Object * parent):
        Object(parent)
    {}

    virtual bool mark (IMark * marker, unsigned markBit) const;

    unsigned getLength () const { return elems.size(); }

    void setLength (unsigned newLen);

    TaggedValue getElem (unsigned index) const
    {
        return index < elems.size() ? elems[index] : JS_UNDEFINED_VALUE;
    }
    void setElem (unsigned index, TaggedValue v);

    virtual TaggedValue getComputed (StackFrame * caller, TaggedValue propName);
    virtual void putComputed (StackFrame * caller, TaggedValue propName, TaggedValue v);
};

struct Array : public ArrayBase
{
    Array (Object * parent):
        ArrayBase(parent)
    {}

    void init (StackFrame * caller);

    static Array * findArrayInstance (StackFrame * caller, TaggedValue thisp);
    static TaggedValue lengthGetter (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * argv);
    static TaggedValue lengthSetter (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * argv);
};

struct ArrayCreator : public Object
{
    ArrayCreator (Object * parent) :
        Object(parent)
    {}

    virtual Object * createDescendant (StackFrame * caller);
};

struct Arguments : public ArrayBase
{
    Arguments (Object * parent):
        ArrayBase(parent)
    {}

    void init (StackFrame * caller, int argc, const TaggedValue * argv);
};

typedef TaggedValue (* CodePtr) (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * args);

struct Function : public Object
{
    Env * env;
    unsigned length; //< number of argumenrs
    CodePtr code;

    Function (Object * parent):
        Object(parent), env(NULL), length(0), code(NULL)
    {}
    void init (StackFrame * caller, Env * env, CodePtr code, const StringPrim * name, unsigned length);

    virtual bool mark (IMark * marker, unsigned markBit) const;

    /** Define the 'prototype' property */
    void definePrototype (StackFrame * caller, Object * prototype);

    bool hasInstance (StackFrame * caller, Object * inst);

    virtual bool isCallable () const;
    virtual TaggedValue call (StackFrame * caller, unsigned argc, const TaggedValue * argv);
};

struct StringPrim : public Memory
{
    const unsigned length;
    //private:
    char _str[];

    StringPrim (unsigned length) :
        length(length)
    {
        this->_str[length] = 0;
    }

    //public:
    bool mark (IMark * marker, unsigned markBit) const;

    static StringPrim * makeEmpty (StackFrame * caller, unsigned length);
    static StringPrim * make (StackFrame * caller, const char * str, unsigned length);

    static StringPrim * make (StackFrame * caller, const char * str)
    {
        return make(caller, str, (unsigned)strlen(str));
    }

    const char * getStr () const
    {
        return this->_str;
    }
};

struct Box : public Object
{
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

typedef Box String;
typedef Box Number;
typedef Box Boolean;

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
        this->escaped = NULL;
#ifdef JS_DEBUG
        this->fileFunc = fileFunc;
        this->line = line;
#endif
        this->localCount = localCount;
        memset(locals, 0, sizeof(locals[0]) * (localCount - skipInit));

        // Note: tricky. We use ourselves as a stack frame here
        if (escapedCount)
            this->escaped = Env::make(this, env, escapedCount);
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

    Env * env;

    typedef std::pair<unsigned,const char*> PasStr;

    struct less_PasStr {
        bool operator() (const PasStr & a, const PasStr & b) const;
    };

    std::map<PasStr,StringPrim*,less_PasStr> permStrings;

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
    const StringPrim * permStrObject;
    const StringPrim * permStrBoolean;
    const StringPrim * permStrNumber;
    const StringPrim * permStrString;
    const StringPrim * permStrFunction;
    const StringPrim * permStrToString;
    const StringPrim * permStrValueOf;

    unsigned markBit; // the value that was used for marking during the previous collection

    struct MemoryHead : public Memory
    {
        virtual bool mark (IMark * marker, unsigned markBit) const;
    };

    MemoryHead head;
    Memory * tail;
    unsigned allocatedSize;
    unsigned gcThreshold;

    Runtime (bool strictMode = true);

    bool mark (IMark * marker, unsigned markBit);

    const StringPrim * internString (StackFrame * caller, const char * str, unsigned len);
    const StringPrim * internString (StackFrame * caller, const char * str);
    void initStrings (StackFrame * caller, const StringPrim ** prims, const char * strconst, const unsigned * offsets, unsigned count);


private:
    void parseDiagEnvironment();
};

extern Runtime * g_runtime;

#ifdef JS_DEBUG
inline Runtime * getRuntime (StackFrame * frame) { return g_runtime; }
#define JS_GET_RUNTIME(frame)  js::getRuntime(frame)
#else
#define JS_GET_RUNTIME(frame)  js::g_runtime
#endif

#define JS_IS_STRICT_MODE(frame) (JS_GET_RUNTIME(frame)->strictMode != false)

TaggedValue objectConstructor (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue functionConstructor (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue stringConstructor (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue numberConstructor (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue booleanConstructor (StackFrame * caller, Env *, unsigned, const TaggedValue *);
TaggedValue arrayConstructor (StackFrame * caller, Env *, unsigned, const TaggedValue *);

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

inline TaggedValue makeObjectValue (Object * o)
{
    if (dynamic_cast<Function *>(o))
        return makeMemoryValue(VT_FUNCTION, o);
    else
        return makeMemoryValue(VT_OBJECT, o);
}

inline TaggedValue makeObjectValue (Function * f)
{
    return makeMemoryValue(VT_FUNCTION, f);
}

inline TaggedValue makeStringValue (const StringPrim * s)
{
    return makeMemoryValue(VT_STRINGPRIM, const_cast<StringPrim*>(s));
}

inline TaggedValue makeStringValue (StackFrame * caller, const char * str)
{
    return makeStringValue(StringPrim::make(caller, str));
}

inline TaggedValue makeInternStringValue (StackFrame * caller, const char * str)
{
    return makeStringValue(JS_GET_RUNTIME(caller)->internString(caller, str));
}

Object * objectCreate (StackFrame * caller, TaggedValue parent);
TaggedValue newFunction (StackFrame * caller, Env * env, const StringPrim * name, unsigned length, CodePtr code);

void throwTypeError (StackFrame * caller, const char * str, ...) JS_NORETURN;
void throwValue (StackFrame * caller, TaggedValue val) JS_NORETURN;

bool isCallable (TaggedValue val);
TaggedValue call(StackFrame * caller, TaggedValue value, unsigned argc, const TaggedValue * argv);

/**
 * Checks whether the value is a non-negative integer
 */
inline bool isNonNegativeInteger (TaggedValue val, uint32_t * index)
{
    if (val.tag == VT_NUMBER) {
        uint32_t n = (uint32_t)val.raw.nval;
        if (n == val.raw.nval) {
            *index = n;
            return true;
        }
    }
    return false;
}

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
int32_t toInt32 (StackFrame * caller, TaggedValue v);
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
TaggedValue operator_DELETE (TaggedValue a);

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
};
