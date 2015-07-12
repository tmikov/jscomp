function switch1 (val)
{
    switch (val) {
        case 10+1-1: return "ten";
        case 20|0: return "twenty";
        case 200/10: return "20.0";
        case 0,30: return "thirty";
        case "2"+"0": return "$twenty";
        default: return "what?";
    }
}

console.log(switch1(10));
console.log(switch1(20));
console.log(switch1(100));
console.log(switch1("100"));
console.log(switch1("20"));
