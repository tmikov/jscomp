var assert = require("assert");

var x = new ArrayBuffer(10);
assert.equal(x.byteLength, 10);
var y = x.slice(-3, -1)
assert.equal(y.byteLength, 2);
assert(!ArrayBuffer.isView(y));

var i8 = new Int8Array(4);
assert(ArrayBuffer.isView(i8));
assert.equal(i8.buffer.byteLength,4);
assert.equal(i8.byteOffset,0);
assert.equal(i8.byteLength,4);
assert.equal(i8.length,4);
assert.equal(i8.BYTES_PER_ELEMENT,1);
i8[1] = 10;
i8[2] = 20;
i8[3] = 257;
assert.equal(i8[1], 10);
assert.equal(i8[2], 20);
assert.equal(i8[3], 1);
i8.set([10,20,257]);
assert.equal(i8[0], 10);
assert.equal(i8[1], 20);
assert.equal(i8[2], 1);
assert.equal(i8[3], 1);
i8.set([10,20,257],1);
assert.equal(i8[0], 10);
assert.equal(i8[1], 10);
assert.equal(i8[2], 20);
assert.equal(i8[3], 1);

var i16 = new Int16Array(4);
assert(ArrayBuffer.isView(i16));
assert.equal(i16.buffer.byteLength,8);
assert.equal(i16.byteOffset,0);
assert.equal(i16.byteLength,8);
assert.equal(i16.length,4);
assert.equal(i16.BYTES_PER_ELEMENT,2);
i16[1] = 10;
i16[2] = 20;
i16[3] = 65537;
assert.equal(i16[1], 10);
assert.equal(i16[2], 20);
assert.equal(i16[3], 1);
i16.set([10,20,65537]);
assert.equal(i16[0], 10);
assert.equal(i16[1], 20);
assert.equal(i16[2], 1);
assert.equal(i16[3], 1);
i16.set([11,21,31],1);
assert.equal(i16[0], 10);
assert.equal(i16[1], 11);
assert.equal(i16[2], 21);
assert.equal(i16[3], 31);
i16.set(i8);
assert.equal(i16[0], 10);
assert.equal(i16[1], 10);
assert.equal(i16[2], 20);
assert.equal(i16[3], 1);

var ii16 = i16.subarray(1);
assert.equal(ii16.length, 3);
assert.equal(ii16.byteOffset, 2);
assert.equal(ii16.byteLength, 6);
assert.equal(ii16[0], 10);
assert.equal(ii16[1], 20);
assert.equal(ii16[2], 1);

var ii8 = new Int8Array(i16.buffer,1,3);
assert.equal(ii8.length, 3);
assert.equal(ii8.byteOffset, 1);
assert.equal(ii8.byteLength, 3);
assert.equal(ii8[0],0); // Little endian!!!
assert.equal(ii8[1],10); // Little endian!!!
assert.equal(ii8[2],0); // Little endian!!!

i8 = new Int8Array([1,2,3,4,5]);
var dv = new DataView(i8.buffer);
assert.equal(dv.getInt8(0),1);
assert.equal(dv.getInt16(0,true),0x0201);
assert.equal(dv.getInt16(0),0x0102);
assert.equal(dv.getInt16(1,true),0x0302);
assert.equal(dv.getInt16(1),0x0203);

dv.setFloat32(1,3.14);
assert.equal(Math.floor(dv.getFloat32(1)*100), 314);
assert.notEqual(Math.floor(dv.getFloat32(1, true)*100), 314);
