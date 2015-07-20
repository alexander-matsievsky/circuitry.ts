/// <reference path="./baconjs.d.ts" />
function CreatingStreams() {
    $("#my-div").asEventStream("click");
    $("#my-div").asEventStream("click", ".more-specific-selector");
    $("#my-div").asEventStream("click", function (event, args) { return args[0]; });
    $("#my-div").asEventStream("click", ".more-specific-selector", function (event, args) { return args[0]; });
    Bacon.fromPromise($.ajax("https://baconjs.github.io/"));
    Bacon.fromPromise(Promise.resolve(1));
    Bacon.fromPromise($.ajax("https://baconjs.github.io/"), true);
    Bacon.fromPromise(Promise.resolve(1), false);
    Bacon.fromPromise($.ajax("https://baconjs.github.io/"), true, function (n) {
        return [new Bacon.Next(n), new Bacon.Next(function () { return n; }), new Bacon.End()];
    });
    Bacon.fromPromise(Promise.resolve(1), false, function (n) {
        return [new Bacon.Next(n), new Bacon.Next(function () { return n; }), new Bacon.End()];
    });
    Bacon.fromEvent(document.body, "click").onValue(function () {
        alert("Bacon!");
    });
    Bacon.fromEvent(document.body, "click", function (event) { return event.clientX; }).onValue(function (clientX) {
        alert("Bacon!");
    });
    Bacon.fromEvent(process.stdin, "readable", function () {
        alert("Bacon!");
    });
    // This would create a stream that outputs a single value "Bacon!" and ends after that. The use of setTimeout causes the value to be delayed by 1 second.
    Bacon.fromCallback(function (callback) {
        setTimeout(function () {
            callback("Bacon!");
        }, 1000);
    });
    // You can also give any number of arguments to `fromCallback`, which will be passed to the function. These arguments can be simple variables, Bacon EventStreams or Properties. For example the following will output "Bacon rules":
    Bacon.fromCallback(function (a, b, callback) {
        callback(a + " " + b);
    }, Bacon.constant("bacon"), "rules").log();
    {
        var fs = require("fs"), read = Bacon.fromNodeCallback(fs.readFile, "input.txt");
        read.onError(function (error) {
            console.log("Reading failed: " + error);
        });
        read.onValue(function (value) {
            console.log("Read contents: " + value);
        });
    }
    Bacon.once(new Bacon.Error("fail"));
    // The following would lead to `1,2,3,1,2,3...` to be repeated indefinitely:
    Bacon.fromArray([1, new Bacon.Error("")]);
    Bacon.repeatedly(10, [1, 2, 3]);
    // The following will produce values `0,1,2`.
    Bacon.repeat(function (i) {
        if (i < 3) {
            return Bacon.once(i);
        }
        else {
            return false;
        }
    }).log();
    {
        var stream = Bacon.fromBinder(function (sink) {
            sink("first value");
            sink([new Bacon.Next("2nd"), new Bacon.Next("3rd")]);
            sink(new Bacon.Next(function () {
                return "This one will be evaluated lazily";
            }));
            sink(new Bacon.Error("oops, an error"));
            sink(new Bacon.End());
            return function () {
                // unsub functionality here, this one's a no-op
            };
        });
        stream.log();
    }
    new Bacon.Next("value");
    new Bacon.Next(function () { return "value"; });
}
function CommonMethodsInEventStreamsAndProperties() {
    // Converting strings to integers, skipping empty values:
    Bacon.once("").flatMap(function (text) {
        return text != "" ? parseInt(text) : Bacon.never();
    });
    Bacon.sequentially(1, [1, 2, 3]).scan(0, function (a, b) { return a + b; });
    Bacon.sequentially(1, [1, 2, 3]).diff(0, function (a, b) { return Math.abs(b - a); });
    // If you have a EventStream `s` with a value sequence `1,2,3,4,5`, the respective values in `s.slidingWindow(2)` would be `[],[1],[1,2],[2,3],[3,4],[4,5]`:
    Bacon.fromArray([1, 2, 3, 4, 5]).slidingWindow(2);
    // The values of `s.slidingWindow(2,2)`would be `[1,2],[2,3],[3,4],[4,5]`:
    Bacon.fromArray([1, 2, 3, 4, 5]).slidingWindow(2, 2);
    {
        var x = Bacon.fromArray([1, 2]), y = Bacon.fromArray([3, 4]);
        x.zip(y, function (x, y) { return x + y; });
    }
    {
        var stream = Bacon.fromArray([1, 2]);
        stream.log("New event in myStream");
        stream.log();
    }
    Bacon.fromArray([1, 2, 3]).withStateMachine(0, function (sum, event) {
        if (event.hasValue()) {
            // had to cast to `number` because event:Bacon.Next<number>|Bacon.Error<{}>
            return [sum + event.value(), []];
        }
        else if (event.isEnd()) {
            return [undefined, [new Bacon.Next(sum), event]];
        }
        else {
            return [sum, [event]];
        }
    });
    {
        var property = Bacon.fromArray([1, 2, 3]).toProperty(), who = Bacon.fromArray(["A", "B", "C"]).toProperty();
        property.decode({ 1: "mike", 2: who });
        property.decode({ 1: { type: "mike" }, 2: { type: "other", whoThen: who } });
    }
    {
        // This is handy for keeping track whether we are currently awaiting an AJAX response:
        var ajaxRequest = {}, ajaxResponse = {}, showAjaxIndicator = ajaxRequest.awaiting(ajaxResponse);
    }
    Bacon.fromArray([1, 2, -3, 3]).withHandler(function (event) {
        if (event.hasValue() && event.value() < 0) {
            this.push(new Bacon.Error("Value below zero"));
            return this.push(new Bacon.End());
        }
        else {
            return this.push(event);
        }
    });
    {
        var src = Bacon.once(1), obs = src.map(function (x) { return -x; });
        console.log(obs.toString()); // > "Bacon.once(1).map(function)"
        obs.withDescription(src, "times", -1);
        console.log(obs.toString()); // > "Bacon.once(1).times(-1)"
    }
    {
        // Calculator for grouped consecutive values until group is cancelled:
        var events = [
            { id: 1, type: "add", val: 3 },
            { id: 2, type: "add", val: -1 },
            { id: 1, type: "add", val: 2 },
            { id: 2, type: "cancel" },
            { id: 3, type: "add", val: 2 },
            { id: 3, type: "cancel" },
            { id: 1, type: "add", val: 1 },
            { id: 1, type: "add", val: 2 },
            { id: 1, type: "cancel" }
        ], keyF = function (event) { return event.id; }, limitF = function (groupedStream) {
            var cancel = groupedStream.filter(function (x) { return x.type === "cancel"; }).take(1), adds = groupedStream.filter(function (x) { return x.type === "add"; });
            return adds.takeUntil(cancel).map(function (x) { return x.val; });
        };
        Bacon.sequentially(2, events)
            .groupBy(keyF, limitF)
            .flatMap(function (groupedStream) { return groupedStream.fold(0, function (acc, x) { return acc + x; }); })
            .onValue(function (sum) {
            console.log(sum); // returns [-1, 2, 8] in an order
        });
    }
}
function EventStream() {
    // This creates the stream which doesn't produce any events and never ends:
    Bacon.interval(1e1, 0).last();
    Bacon.fromArray([1, 2, 2, 1])
        .skipDuplicates().log(); // > returns [1, 2, 1] in an order
    // You might get two events containing [1,2,3,4] and [5,6,7] respectively, given that the flush occurs between numbers 4 and 5:
    Bacon.fromArray([1, 2, 3, 4, 5, 6, 7]).bufferWithTime(0);
    // Here's an equivalent to `stream.bufferWithTime(10)`:
    {
        var stream = Bacon.fromArray([1, 2, 3, 4, 5, 6, 7]);
        stream.bufferWithTime(function (f) {
            setTimeout(f, 10);
        });
    }
    // You will get output events with values `[1, 2]`, `[3, 4]` and `[5]`.
    Bacon.fromArray([1, 2, 3, 4, 5]).bufferWithCount(2);
}
function Property() {
    // This creates the property which doesn't produce any events and never ends:
    Bacon.interval(1e1, 0).toProperty().last();
    {
        var property = Bacon.fromArray([1, 2, 3, 4, 5]).toProperty();
        // If you want to assign your Property to the "disabled" attribute of a JQuery object, you can do this:
        property.assign($("#my-button"), "attr", "disabled");
        // A simpler example would be to toggle the visibility of an element based on a Property:
        property.assign($("#my-button"), "toggle");
    }
    Bacon.fromArray([1, 2, 2, 1]).toProperty()
        .skipDuplicates().log(); // > returns [1, 2, 1] in an order
}
function CombiningMultipleStreamsAndProperties() {
    {
        var property = Bacon.constant(1), stream = Bacon.once(2), constant = 3;
        Bacon.combineAsArray(property, stream, constant)
            .log(); // > returns [1, 2, 3]
    }
    {
        // To calculate the current sum of three numeric Properties, you can do:
        var property = Bacon.constant(1), stream = Bacon.once(2), constant = 3;
        // NOTE: had to explicitly specify the typing for `x:number, y:number, z:number`
        Bacon.combineWith(function (x, y, z) { return x + y + z; }, property, stream, constant);
    }
    {
        // Assuming you've got streams or properties named `password`, `username`, `firstname` and `lastname`, you can do:
        var password = Bacon.constant("easy"), username = Bacon.constant("juha"), firstname = Bacon.constant("juha"), lastname = Bacon.constant("paananen"), 
        // NOTE: you should provide `combineTemplate` typing explicitly!
        loginInfo = Bacon.combineTemplate({
            magicNumber: 3,
            userid: username,
            passwd: password,
            name: { first: firstname, last: lastname }
        }).onValue(function (loginInfo) {
            // and your new `loginInfo` property will combine values from all these streams using that template, whenever any of the streams/properties get a new value. It would yield a value:
            console.log("`loginInfo` expected", {
                magicNumber: 3,
                userid: "juha",
                passwd: "easy",
                name: { first: "juha", last: "paananen" }
            });
            console.log("`loginInfo` actual", loginInfo);
        });
        // Note that all Bacon.combine* methods produce a `Property` instead of an `EventStream`. If you need the result as an `EventStream` you might want to use `property.changes()`:
        Bacon.combineWith(function (firstname, lastname) { return (firstname + " " + lastname); }, firstname, lastname).changes();
    }
    {
        var x = Bacon.fromArray([1, 2, 3]), y = Bacon.fromArray([10, 20, 30]), z = Bacon.fromArray([100, 200, 300]);
        Bacon.zipAsArray(x, y, z)
            .log(); // > returns values `[1, 10, 100]`, `[2, 20, 200]` and `[3, 30, 300]`
    }
    // The following example would log the number 3.
    // NOTE: had to explicitly specify the typing for `a:number, b:number`
    Bacon.onValues(Bacon.constant(1), Bacon.constant(2), function (a, b) {
        console.log(a + b);
    });
}
function $Event() {
    new Bacon.Next("value");
    new Bacon.Next(function () { return "value"; });
}
function Errors() {
    // In case you want to convert (some) value events into Error events, you may use `flatMap` like this:
    // NOTE: had to explicitly specify the typing for `flatMap`
    Bacon.fromArray([1, 2, 3, 4]).flatMap(function (x) {
        return x > 2 ? new Bacon.Error("too big") : x;
    });
    // Conversely, if you want to convert some Error events into value events, you may use `flatMapError`:
    Bacon.fromArray([1, 2, 3, 4]).flatMapError(function (error) {
        var isNonCriticalError = function (error) { return Math.random() < .5; }, handleNonCriticalError = function (error) { return 42; };
        return isNonCriticalError(error) ? handleNonCriticalError(error) : new Bacon.Error(error);
    });
    // Note also that Bacon.js combinators do not catch errors that are thrown. Especially `map` doesn't do so. If you want to map things and wrap caught errors into Error events, you can do the following:
    Bacon.fromArray([1, 2, 3, 4]).flatMap(function (x) {
        var dangerousFunction = function (x) {
            throw new Error("dangerous function!");
        };
        try {
            return dangerousFunction(x);
        }
        catch (e) {
            return new Bacon.Error(e);
        }
    });
    Bacon.once("https://baconjs.github.io/").flatMap(function (url) {
        // `ajaxCall` gives `Error`s on network or server `Error`s.
        var ajaxCall = function (url) {
            return Bacon.fromPromise($.ajax(url));
        };
        return Bacon.retry({
            source: function () { return ajaxCall(url); },
            retries: 5,
            isRetryable: function (error) { return error.status !== 404; },
            delay: function (context) { return 100; } // Just use the same delay always
        });
    });
}
function JoinPatterns() {
    {
        // Consider implementing a game with discrete time ticks. We want to handle key-events synchronized on tick-events, with at most one key event handled per tick. If there are no key events, we want to just process a tick:
        var tick = Bacon.interval(1e2, 0), keyEvent = Bacon.fromEvent(document.body, "click", function (_) { return Date.now(); }), handleTick = function (_) { return "timestamp: NONE"; }, handleKeyEvent = function (timestamp) { return ("timestamp: " + timestamp); };
        Bacon.when([tick, keyEvent], function (_, timestamp) { return handleKeyEvent(timestamp); }, [tick], handleTick);
    }
    {
        // Join patterns are indeed a generalization of `zip`, and `zip` is equivalent to a single-rule join pattern. The following `Observable`s have the same output:
        var a = Bacon.once("a"), b = Bacon.once("b"), c = Bacon.once("c"), f = function (a, b, c) { return ("a = " + a + "; b = " + b + "; c = " + c + "."); };
        Bacon.zipWith(f, a, b, c);
        Bacon.when([a, b, c], f);
    }
    {
        // The inputs to `Bacon.update` are defined like this:
        var initial = 0, x = Bacon.interval(1e3, 1), y = Bacon.interval(2e3, 1), z = Bacon.interval(1.5e3, 1);
        // NOTE: had to explicitly specify the typing for `previous:number`
        Bacon.update(initial, [x, y, z], function (previous, x, y, z) { return previous + x + y + z; }, [x, y], function (previous, x, y) { return previous + x + y; });
    }
    {
        // Here's a simple gaming example:
        var scoreMultiplier = Bacon.constant(1), hitUfo = new Bacon.Bus(), hitMotherShip = new Bacon.Bus(), score = Bacon.update(0, [hitUfo, scoreMultiplier], function (score, _, multiplier) { return score + 100 * multiplier; }, [hitMotherShip], function (score, _) { return score + 2000; });
    }
}
