// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

function InternalModule(filename, body)
{
    var module = new Module(filename);
    this.module = module;
    this.body = body;
    this.loadStarted = false;

    this.boundRequire = function boundRequire (id) {
        return module.require(id);
    }
}

function Module (filename)
{
    this.id = this.filename = filename;
    this.loaded = false;
    this.parent = null;
    this.children = [];
    this.exports = {};
}

Module.prototype.require = moduleRequire;

var modules = Object.create(null);

function moduleRequire (id)
{
    var imod = modules[id];
    if (!imod)
        throw new Error("module "+ id +" is not known");
    var mod = imod.module;
    if (imod.loadStarted)
        return mod.exports;

    imod.loadStarted = true;
    if (!mod.parent)
        mod.parent = this;

    imod.body(mod, imod.boundRequire);

    mod.loaded = true;
    mod.children.push(mod);
    return mod.exports;
}

function defineModule(name, code)
{
    return modules[name] = new InternalModule(name, code);
}
