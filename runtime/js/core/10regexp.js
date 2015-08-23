// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

__asmh__({}, '#define PCRE2_CODE_UNIT_WIDTH 8');
__asmh__({}, '#include "jsc/pcre2.h"');

var PCRE2_CASELESS = __asm__({},["result"],[],[],"%[result] = js::makeNumberValue(PCRE2_CASELESS);");
var PCRE2_MULTILINE = __asm__({},["result"],[],[],"%[result] = js::makeNumberValue(PCRE2_MULTILINE);");
var PCRE2_ERROR_NOMATCH = __asm__({},["result"],[],[],"%[result] = js::makeNumberValue(PCRE2_ERROR_NOMATCH);");
var PCRE2_ERROR_PARTIAL = __asm__({},["result"],[],[],"%[result] = js::makeNumberValue(PCRE2_ERROR_PARTIAL);");

function pcre2_get_error_message (errorCode)
{
    return "RegExp: " +  __asm__({},["result"],[["errorCode",errorCode|0]],[],
        "static PCRE2_UCHAR sbuf[256];\n" +
        "PCRE2_UCHAR * buf = sbuf;\n" +
        "PCRE2_SIZE bufflen = 256;\n" +
        "int len;\n" +
        "while ((len = pcre2_get_error_message((int)%[errorCode].raw.nval, buf, bufflen)) < 0) {\n" +
        "  if (buf != sbuf) free(buf);\n" +
        "  bufflen <<= 1;" +
        "  buf = (PCRE2_UCHAR *)malloc(sizeof(PCRE2_UCHAR)*bufflen);\n" +
        "  if (!buf) js::throwOutOfMemory(%[%frame]);" +
        "}\n" +
        "%[result] = js::makeStringValue(js::StringPrim::make(%[%frame], (const char *)buf, len));\n" +
        "if (buf != sbuf) free(buf);"
    );
}

var $RegExp = RegExp = function RegExp (pattern, flags)
{
    if (!(this instanceof RegExp))
        return new RegExp(pattern, flags);

    // Set the internal class
    __asm__({},[],[["this", this]],[],
        "((js::NativeObject *)%[this].raw.oval)->setInternalClass(js::ICLS_REGEXP);"
    );

    // Set the finalizer
    __asmh__({},
        "static void regexp_finalizer (js::NativeObject * obj)\n" +
        "{\n" +
        "  pcre2_code * re = (pcre2_code *)obj->getInternalUnsafe(0);\n" +
        "  pcre2_match_data * match = (pcre2_match_data *)obj->getInternalUnsafe(1);\n" +
        "  if (match) pcre2_match_data_free(match);\n" +
        "  if (re) pcre2_code_free(re);\n" +
        "}"
    );
    __asm__({},[],[["this", this]],[],
        "((js::NativeObject *)%[this].raw.oval)->setNativeFinalizer(regexp_finalizer);"
    );

    // Parse the flags
    var global = false;
    var ignoreCase = false;
    var multiline = false;
    var nflags = 0;

    if (flags) {
        flags = String(flags);
        for ( var i = 0, e = flags.length; i < e; ++i ) {
            switch (flags[i]) {
                case "g":
                    global = true;
                    break;
                case "i":
                    ignoreCase = true;
                    nflags |= PCRE2_CASELESS;
                    break;
                case "m":
                    multiline = true;
                    nflags |= PCRE2_MULTILINE;
                    break;
                default:
                    throw SyntaxError("RegExpt: ~invalid flag '"+ flags[i] +"' supplied to RegExp constructor");
            }
        }
    }

    // Get the pattern as string
    if (pattern instanceof RegExp)
        pattern = pattern.source;

    pattern = pattern !== undefined ? String(pattern) : "";

    // Compile the pattern
    var errorCode = __asm__({},["errorCode"],[["this", this], ["pattern", pattern], ["nflags", nflags]],[],
        "js::NativeObject * obj = (js::NativeObject *)%[this].raw.oval;\n" +
        "pcre2_code * re;\n" +
        "int errorCode;\n" +
        "PCRE2_SIZE errorOffset;\n" +
        "re = pcre2_compile(%[pattern].raw.sval->_str, %[pattern].raw.sval->byteLength, " +
        "PCRE2_ALT_BSUX | PCRE2_NEVER_BACKSLASH_C | PCRE2_NEVER_UCP | PCRE2_NO_UTF_CHECK | PCRE2_UTF | " +
            "(unsigned)(%[nflags].raw.nval), " +
        "&errorCode, &errorOffset, NULL" +
        ");\n" +
        "if (re) {\n" +
        "  obj->setInternalUnsafe(0, (uintptr_t)re);\n" +
        "  %[errorCode] = js::makeNumberValue(0);\n" +
        "  pcre2_match_data * match = pcre2_match_data_create_from_pattern(re, NULL);\n" +
        "  if (!match) js::throwOutOfMemory(%[%frame]);\n" +
        "  obj->setInternalUnsafe(1, (uintptr_t)match);\n" +
        "} else {\n" +
        "  %[errorCode] = js::makeNumberValue(errorCode);\n" +
        "}"
    );
    if (errorCode)
        throw SyntaxError(pcre2_get_error_message(errorCode));

    Object.defineProperties(this, {
        source: {value: pattern},
        flags: {value: flags},
        global: {value: global},
        ignoreCase: {value: ignoreCase},
        multiline: {value: multiline},
        lastIndex: {writable: true, value: 0}
    });
}

var regexp_prototype = createNative(2);
RegExp.prototype = regexp_prototype;

Object.defineProperties(RegExp.prototype, {
    source: {value: ""},
    flags: {value: ""},
    global: {value: false},
    ignoreCase: {value: false},
    multiline: {value: false}
});

function isRegExp (obj)
{
    // TODO: perform stricter validation, e.g. with symbols?
    if (obj.__proto__ === regexp_prototype) {
        if ( __asm__({},["result"],[["obj",obj]],[],
                "%[result] = js::makeBooleanValue(js::getInternalClass(%[obj]) == js::ICLS_REGEXP);"
            ))
        {
            return true;
        }
    }
    return false;
}

function validateObject (obj)
{
    if (!isRegExp(obj))
        throw TypeError("'this' is not a RegExp");
}

function getSubstringByNumber (obj, str, num)
{
    return __asm__({},["result"],[["this",obj], ["str", str], ["num", num >>> 0]],[],
        "js::NativeObject * obj = (js::NativeObject *)%[this].raw.oval;\n" +
        "pcre2_match_data * match = (pcre2_match_data *)obj->getInternalUnsafe(1);\n" +
        "PCRE2_SIZE * ptr = pcre2_get_ovector_pointer(match);\n" +
        "ptr += (unsigned)%[num].raw.nval * 2;\n" +
        "if (ptr[0] == PCRE2_UNSET || ptr[1] == PCRE2_UNSET)\n" +
        "  %[result] = js::makeStringValue(JS_GET_RUNTIME(%[%frame])->permStrEmpty);\n" +
        "else\n" +
        "  %[result] = %[str].raw.sval->byteSubstring(%[%frame], ptr[0], ptr[1]);"
    );
}

function getSubstringIndexByNumber (obj, str, num, which)
{
    return __asm__({},["result"],[["this",obj], ["str", str], ["num", num >>> 0], ["which", which >>> 0]],[],
        "js::NativeObject * obj = (js::NativeObject *)%[this].raw.oval;\n" +
        "pcre2_match_data * match = (pcre2_match_data *)obj->getInternalUnsafe(1);\n" +
        "PCRE2_SIZE * ptr = pcre2_get_ovector_pointer(match);\n" +
        "ptr += (unsigned)%[num].raw.nval * 2 + (unsigned)%[which].raw.nval;\n" +
        "if (*ptr == PCRE2_UNSET)\n" +
        "  %[result] = js::makeNumberValue(0);\n" +
        "else\n" +
        "  %[result] = js::makeNumberValue(%[str].raw.sval->byteOffsetToUTF16Index(*ptr));"
    );
}

function domatch (obj, str)
{
    validateObject(obj);

    str = String(str);

    if (obj.global && obj.lastIndex >= str.length) {
        obj.lastIndex = 0;
        return null;
    }

    var count = 0;
    var errorCode = __asm__({},["errorCode"],
        [["this",obj], ["str", str], ["startIndex", obj.lastIndex >>> 0], ["count", count]], [],

        "js::NativeObject * obj = (js::NativeObject *)%[this].raw.oval;\n" +
        "pcre2_code * re = (pcre2_code *)obj->getInternalUnsafe(0);\n" +
        "pcre2_match_data * match = (pcre2_match_data *)obj->getInternalUnsafe(1);\n" +
        "PCRE2_SIZE startoffset = 0;\n" +
        "if (%[startIndex].raw.nval) {\n" +
        "  bool secondSurrogate;" +
        "  const unsigned char * p = %[str].raw.sval->charPos((uint32_t)%[startIndex].raw.nval, &secondSurrogate);\n" +
        "  startoffset = p - %[str].raw.sval->_str;\n" +
        "}\n" +
        "int rc = pcre2_match(re, %[str].raw.sval->_str, %[str].raw.sval->byteLength," +
        "  startoffset," +
        "  PCRE2_NO_UTF_CHECK," +
        "  match, NULL" +
        ");\n" +
        "%[errorCode] = js::makeNumberValue(rc);\n" +
        "if (rc >= 0) {\n" +
        "  %[count] = js::makeNumberValue(pcre2_get_ovector_count(match));\n" +
        "}"
    );

    if (errorCode === PCRE2_ERROR_NOMATCH || errorCode === PCRE2_ERROR_PARTIAL) { // match failed?
        obj.lastIndex = 0;
        return null;
    }
    if (errorCode < 0)
        throw SyntaxError(pcre2_get_error_message(errorCode));

    return count;
}

hidden(RegExp.prototype, "exec", function regexp_exec (str)
{
    var count = domatch(this, str);

    if (count === null)
        return null;

    var res = new Array(count);
    res.input = str;
    res.index = getSubstringIndexByNumber(this, str, 0, 0);
    if (this.global)
        this.lastIndex = getSubstringIndexByNumber(this, str, 0, 1);

    for ( var i = 0; i < count; ++i )
        res[i] = getSubstringByNumber(this, str, i);

    return res;
});

hidden(RegExp.prototype, "test", function regexp_test (str)
{
    return domatch(this, str) !== null;
});

hidden(RegExp.prototype, "toString", function regexp_toString()
{
    validateObject(this);
    return "/" + this.source + "/" + this.flags;
});
