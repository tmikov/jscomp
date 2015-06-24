TSC=tsc
TSFLAGS=--module commonjs --target ES5 --sourceMap --noImplicitAny --noEmitOnError

%.js : %.ts
	$(TSC) $(TSFLAGS) $<

.PHONY: all clean runtime-debug runtime-release runtime

all:
	$(TSC) $(TSFLAGS) main.ts

clean:
	@rm -f -v *.js *.js.map
	@rm -f -v src/*.js lib/*.js lib/*.js.map

runtime-debug:
	mkdir -p runtime/debug
	cd runtime/debug && cmake -DCMAKE_BUILD_TYPE=Debug .. && make -j2

runtime-release:
	mkdir -p runtime/release
	cd runtime/release && cmake -DCMAKE_BUILD_TYPE=Release .. && make -j2

runtime: runtime-debug runtime-release
