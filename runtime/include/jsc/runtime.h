// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#include <map>
#include <vector>
#include <string>
#include <stdlib.h>

#define JS_DEBUG

#define JS_NORETURN __attribute__((noreturn))

namespace js
{

struct Env;
struct PropertyAccessor;
struct Memory;
struct Object;
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
    VT_UNDEFINED, VT_NULL, VT_BOOLEAN, VT_NUMBER, VT_STRINGPRIM, VT_MEMORY, VT_OBJECT, VT_FUNCTION,
};

inline bool isValueTagPointer (ValueTag t)
{
    return t >= VT_STRINGPRIM;
}
inline bool isValueTagPrimitive (ValueTag t)
{
    return t <= VT_STRINGPRIM;
}
inline bool isValueTagObject (ValueTag t)
{
    return t >= VT_OBJECT;
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
    virtual bool _mark (Memory *) = 0;
};

struct Memory
{
    enum : uintptr_t
    {
        FLAGS_MASK = 0x01, MARK_BIT_MASK = 0x01
    };

    uintptr_t header; //< used by GC
    unsigned gcSize;

    Memory * getNext () const
    {
        return (Memory *)(header & ~FLAGS_MASK);
    }

    void setNext (Memory * next)
    {
        header = (uintptr_t)next | (header & FLAGS_MASK);
    }

    virtual bool mark (IMark * marker, unsigned markBit) = 0;

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

    virtual bool mark (IMark * marker, unsigned markBit);

    static Env * make (StackFrame * caller, Env * parent, unsigned size);

    TaggedValue * var (unsigned index)
    { return vars + index; }

    TaggedValue * var (unsigned level, unsigned index);
};

enum PropAttr
{
    PROP_ENUMERABLE = 0x01, PROP_WRITEABLE = 0x02, PROP_CONFIGURABLE = 0x04, PROP_GET_SET = 0x08,
};

struct Property
{
    unsigned flags;
    TaggedValue value;

    Property () :
        flags(0)
    {}

    Property (unsigned flags, TaggedValue value) :
        flags(flags), value(value)
    {}
};

enum ObjectFlags
{
    OF_NOEXTEND = 1,  // New properties cannot be added
    OF_NOCONFIG = 2,  // properties cannot be configured or deleted
    OF_NOWRITE  = 4,  // property values cannot be modified
};

struct Object : public Memory
{
    unsigned flags;
    Object * parent;
    std::map<std::string, Property> props;

    Object (Object * parent) :
        flags(0),
        parent(parent)
    { }

    virtual bool mark (IMark * marker, unsigned markBit);

    Object * defineOwnProperty (
        StackFrame * caller, const std::string name, unsigned flags,
        TaggedValue value = JS_UNDEFINED_VALUE, Function * get = NULL, Function * set = NULL
    );

    Property * getOwnProperty (const std::string & name)
    {
        auto it = this->props.find(name);
        return it != this->props.end() ? &it->second : NULL;
    }

    Property * getProperty (const std::string & name);

    TaggedValue get (StackFrame * caller, const std::string & name);
    void put (StackFrame * caller, const std::string & name, TaggedValue v);

    bool deleteProperty (const std::string & name);

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
};

struct PropertyAccessor : public Memory
{
    Function * get;
    Function * set;

    PropertyAccessor (Function * get, Function * set) :
        get(get), set(set)
    { }

    virtual bool mark (IMark * marker, unsigned markBit);
};

struct Arguments : public Object
{
    std::vector<TaggedValue> elems;
    unsigned length;
    // TODO: array-line functionality
};

struct Array : public Object
{
    std::vector<TaggedValue> elems;

    virtual bool mark (IMark * marker, unsigned markBit);

    unsigned getLength ()
    { return elems.size(); }

    void setLength (unsigned newLen);

    TaggedValue getElem (unsigned index);

    void setElem (unsigned index, TaggedValue v);
};

typedef TaggedValue (* CodePtr) (StackFrame * caller, Env * env, unsigned argc, const TaggedValue * args);

struct Function : public Object
{
    Object * prototype;
    Env * env;
    unsigned length; //< number of argumenrs
    CodePtr code;

    Function (StackFrame * caller, Object * parent, Env * env, const std::string & name, unsigned length, CodePtr code);

    virtual bool mark (IMark * marker, unsigned markBit);

    void definePrototype (StackFrame * caller, Object * prototype);

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
    bool mark (IMark * marker, unsigned markBit);

    static StringPrim * makeEmpty (StackFrame * caller, unsigned length);
    static StringPrim * make (StackFrame * caller, const char * str, unsigned length);

    static StringPrim * make (StackFrame * caller, const char * str)
    {
        return make(caller, str, (unsigned)strlen(str));
    }

    static StringPrim * make (StackFrame * caller, const std::string & str)
    {
        return make(caller, str.data(), (unsigned)str.length());
    }

    const char * getStr () const
    {
        return this->_str;
    }
};

struct String : public Object
{
    TaggedValue value;

    String (Object * parent, TaggedValue value) :
        Object(parent), value(value)
    {}

    bool mark (IMark * marker, unsigned markBit);
    virtual TaggedValue defaultValue (StackFrame * caller, ValueTag preferredType);
};

struct Number : public Object
{
    TaggedValue value;

    Number (Object * parent, TaggedValue value) :
        Object(parent), value(value)
    {}
    virtual TaggedValue defaultValue (StackFrame * caller, ValueTag preferredType);
};

struct Boolean : public Object
{
    TaggedValue value;

    Boolean (Object * parent, TaggedValue value) :
        Object(parent), value(value)
    {}
    virtual TaggedValue defaultValue (StackFrame * caller, ValueTag preferredType);
};

struct StackFrame
{
    Runtime * runtime;
    StackFrame * caller;
    Env * escaped;
#ifdef JS_DEBUG
    const char * fileFunc;
    unsigned line;
#endif
    unsigned localCount;
    TaggedValue locals[0];

    StackFrame (Runtime * runtime, StackFrame * caller, Env * env, unsigned escapedCount, unsigned localCount,
                unsigned skipInit
#ifdef JS_DEBUG
        , const char * fileFunc, unsigned line
#endif
    )
    {
        this->caller = caller;
        this->runtime = runtime;
        this->escaped = escapedCount ? Env::make(caller, env, escapedCount) : NULL;
#ifdef JS_DEBUG
        this->fileFunc = fileFunc;
        this->line = line;
#endif
        this->localCount = localCount;
        memset(locals + skipInit, 0, sizeof(locals[0]) * (localCount - skipInit));
    }

    bool mark (IMark * marker, unsigned markBit);

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

    StackFrameN (Runtime * runtime, StackFrame * caller, Env * env, const char * fileFunc, unsigned line) :
#ifdef JS_DEBUG
        StackFrame(runtime, caller, env, E, L, SkipInit, fileFunc, line)
#else
        StackFrame( runtime, caller, env, E, L, SkipInit )
#endif
    { }

    StackFrameN (StackFrame * caller, Env * env, const char * fileFunc, unsigned line) :
#ifdef JS_DEBUG
        StackFrame(caller->runtime, caller, env, E, L, SkipInit, fileFunc, line)
#else
        StackFrame( caller->runtime, caller, env, E, L, SkipInit )
#endif
    { }
};

struct Runtime
{
    enum
    {
        DIAG_HEAP_ALLOC = 0x01, DIAG_HEAP_ALLOC_STACK = 0x02, DIAG_HEAP_GC = 0x04, DIAG_HEAP_GC_VERBOSE = 0x08,
        DIAG_ALL = 0x0F
    };
    unsigned diagFlags;

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

    Boolean * trueObject;
    Boolean * falseObject;

    Env * env;

    std::map<std::string,StringPrim*> permStrings;

    TaggedValue permStrUndefined;
    TaggedValue permStrNull;
    TaggedValue permStrTrue;
    TaggedValue permStrFalse;
    TaggedValue permStrNaN;

    unsigned markBit; // the value that was used for marking during the previous collection

    struct MemoryHead : public Memory
    {
        virtual bool mark (IMark * marker, unsigned markBit);
    };

    MemoryHead head;
    Memory * tail;
    unsigned allocatedSize;
    unsigned gcThreshold;

    Runtime ();

    bool mark (IMark * marker, unsigned markBit);

    TaggedValue definePermString (StackFrame * caller, const std::string & str);
};


inline bool markValue (IMark * marker, unsigned markBit, const TaggedValue & value)
{
    if (isValueTagPointer((ValueTag)value.tag) && (value.raw.mval->header & Memory::MARK_BIT_MASK) != markBit)
        return marker->_mark(value.raw.oval);
    else
        return true;
}

inline bool markMemory (IMark * marker, unsigned markBit, Memory * mem)
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

inline TaggedValue makeStringValue (StringPrim * s)
{
    return makeMemoryValue(VT_STRINGPRIM, s);
}

inline TaggedValue makeStringValue (StackFrame * caller, const std::string & str)
{
    return makeStringValue(StringPrim::make(caller, str));
}

inline TaggedValue makeStringValue (StackFrame * caller, const char * str)
{
    return makeStringValue(StringPrim::make(caller, str));
}

TaggedValue newFunction (StackFrame * caller, Env * env, const std::string & name, unsigned length, CodePtr code);


void throwTypeError (StackFrame * caller, const std::string & str) JS_NORETURN;

bool isCallable (TaggedValue val);
TaggedValue callFunction (StackFrame * caller, TaggedValue value, unsigned argc, const TaggedValue * argv);

Object * toObject (StackFrame * caller, TaggedValue v);

TaggedValue toPrimitive (StackFrame * caller, TaggedValue v, ValueTag preferredType = (ValueTag)0);
double toNumber (const StringPrim * str);
double toNumber (StackFrame * caller, TaggedValue v);
int32_t toInt32 (StackFrame * caller, TaggedValue v);
TaggedValue toString (StackFrame * caller, double n);
TaggedValue toString (StackFrame * caller, TaggedValue v);

TaggedValue concatString (StackFrame * caller, StringPrim * a, StringPrim * b);
TaggedValue operator_ADD (StackFrame * caller, TaggedValue a, TaggedValue b);
};
