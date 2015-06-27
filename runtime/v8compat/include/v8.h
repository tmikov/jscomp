// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#ifndef JSCOMP_V8_H
#define JSCOMP_V8_H

class Isolate;
class HandleScope;
class Handle;

class Isolate
{
    HandleScope * m_topScope;
    static thread_local Isolate * s_curIsolate;

    Isolate ()
    {
        m_topScope = 0;
        s_curIsolate = this;
    }

public:
    static Isolate * GetCurrent()
    {
        return s_curIsolate;
    }

    HandleScope * _topScope () const
    {
        return m_topScope;
    }

    HandleScope * _pushScope (HandleScope * scope)
    {
        HandleScope * res = m_topScope;
        m_topScope = scope;
        return res;
    }

    void _popScope (HandleScope * parent)
    {
       m_topScope = parent;
    }
};

class HandleScope
{
    Isolate * const m_isolate;
    HandleScope * m_parent;
public:
    HandleScope (Isolate * isolate) :
        m_isolate(isolate)
    {
        m_parent = isolate->_pushScope(this);
    }

    ~HandleScope ()
    {
       m_isolate->_popScope(m_parent);
    }

    void _addHandle (Handle * h);
};

class Handle
{

};


template <class T>
class Local
{
    Handle * m_handle;
public:
    Local (T * v)
    {
        m_handle = 0; // FIXME
        Isolate::GetCurrent()->_topScope()->_addHandle(m_handle);
    }
};

#endif //JSCOMP_V8_H
