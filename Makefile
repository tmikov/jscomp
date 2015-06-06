TSC=tsc
TSFLAGS=--module commonjs --target ES5 --sourceMap --noImplicitAny

%.js : %.ts
	$(TSC) $(TSFLAGS) $<

.PHONY: all clean

all:
	$(TSC) $(TSFLAGS) main.ts

clean:
	@rm -f -v *.js *.js.map
	@rm -f -v src/*.js lib/*.js lib/*.js.map

