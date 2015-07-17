function testFunc (a, b, c)
{
    console.log("testFunc", this, a, b, c);
}

testFunc(1,2,3);
testFunc.call("this1",4,5,6);
testFunc.call("this2",7,8);
testFunc.apply();
testFunc.apply("this3");
testFunc.apply("this4", [10,11,12]);
testFunc.apply("this5", [13,14]);
