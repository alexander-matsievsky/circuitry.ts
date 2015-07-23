import {Circuit, Bacon} from "../../src/lib";

enum Operator { PLUS, MINUS, TIMES, DIVISION }

let calc = new Circuit({
    title: "Calculator",
    descr: "Kinda analog calculator"
  }),
  decodeOperand = (fieldset, initialValue) =>
    Bacon.fromEvent<Error, Event, HTMLButtonElement>(fieldset, "click", ({target}) => <HTMLButtonElement>target)
      .filter(button => button.name === "digit")
      .scan(initialValue, (line, {value}) => {
        return /^[0-9]$/.test(value) ? line + value : value === "" ? line.slice(0, line.length - 1) : line;
      })
      .map(line => parseInt(line, 10) || 0)
      .toEventStream();

let lhs = calc.Block({
  title: "LHS operand generator",
  descr: "Provides left-hand-side operand for calculation"
}, {
  Mem: () => ({
    initialValue: "12345",
    keyboard: <HTMLFieldSetElement>document.querySelector("form[name=calculator] fieldset[name=first-operand]"),
    display: <HTMLSpanElement>document.querySelector("form[name=calculator] fieldset[name=first-operand] code")
  }),
  In: {},
  Out: {
    value: calc.Out<number>({title: "LHS operand", descr: "LHS operand"})
  }
}, (Mem, In, Out) => {
  Out.value.$ = decodeOperand(Mem.keyboard, Mem.initialValue);
})
  .Effect<number>({
    title: "LHS operand printer",
    descr: "Prints left-hand-side operand to display"
  }, (In, Out) => Out.value, (Mem, value) => {
    Mem.display.innerHTML = `${value}`;
  });

let rhs = calc.Block({
  title: "RHS operand generator",
  descr: "Provides right-hand-side operand for calculation"
}, {
  Mem: () => ({
    initialValue: "67890",
    keyboard: <HTMLFieldSetElement>document.querySelector("form[name=calculator] fieldset[name=second-operand]"),
    display: <HTMLSpanElement>document.querySelector("form[name=calculator] fieldset[name=second-operand] code")
  }),
  In: {},
  Out: {
    value: calc.Out<number>({title: "RHS operand", descr: "RHS operand"})
  }
}, (Mem, In, Out) => {
  Out.value.$ = decodeOperand(Mem.keyboard, Mem.initialValue);
})
  .Effect<number>({
    title: "RHS operand printer",
    descr: "Prints right-hand-side operand to display"
  }, (In, Out) => Out.value, (Mem, n) => {
    Mem.display.innerHTML = `${n}`;
  });

let op = calc.Block({
  title: "Operator generator",
  descr: "Provides operator for calculation"
}, {
  Mem: () => ({
    initialValue: "",
    keyboard: <HTMLFieldSetElement>document.querySelector("form[name=calculator] fieldset[name=operator]"),
    display: <HTMLSpanElement>document.querySelector("form[name=calculator] fieldset[name=operator] code")
  }),
  In: {},
  Out: {
    value: calc.Out<Operator>({title: "Operator", descr: ""}),
    symbol: calc.Out<string>({title: "Operator symbol", descr: ""})
  }
}, (Mem, In, Out)=> {
  let sign = Bacon.fromEvent<Error, Event, HTMLButtonElement>(Mem.keyboard, "click", ({target}) => <HTMLButtonElement>target)
    .filter(({name}) => name === "sign")
    .map(({value}) => value);

  Out.symbol.$ = sign;
  Out.value.$ = sign.map(sign => {
    switch (sign) {
      case "+":
        return Operator.PLUS;
      case "-":
        return Operator.MINUS;
      case "*":
        return Operator.TIMES;
      case "/":
        return Operator.DIVISION;
    }
  });
})
  .Effect<string>({
    title: "Operator printer",
    descr: ""
  }, (In, Out) => Out.symbol, (Mem, symbol) => {
    Mem.display.innerHTML = symbol;
  });

let calculator = calc.Block({
  title: "Calculator",
  descr: "Simple binary operation calculator"
}, {
  Mem: () => ({
    display: <HTMLSpanElement>document.querySelector("form[name=calculator] fieldset[name=result] code")
  }),
  In: {
    lhs: calc.In<number>({title: "A", descr: "First operand"}),
    rhs: calc.In<number>({title: "B", descr: "Second operand"}),
    op: calc.In<Operator>({title: "O", descr: "Operand"})
  },
  Out: {
    c: calc.Out<number>({title: "C", descr: "Result"})
  }
}, (Mem, In, Out) => {
  Out.c.$ = Bacon.combineTemplate<Error, {lhs:number; rhs:number; op:Operator}>({
    lhs: In.lhs.$, rhs: In.rhs.$, op: In.op.$
  })
    .toEventStream()
    .map(({lhs, rhs, op}) => {
      switch (op) {
        case Operator.PLUS:
          return lhs + rhs;
        case Operator.MINUS:
          return lhs - rhs;
        case Operator.TIMES:
          return lhs * rhs;
        case Operator.DIVISION:
          return lhs / rhs;
      }
    });
})
  .Effect<number>({
    title: "Result printer",
    descr: ""
  }, (In, Out) => Out.c, (Mem, c) => {
    Mem.display.innerHTML = `${c}`;
  });

calc.Wire(lhs.Out.value, calculator.In.lhs);
calc.Wire(rhs.Out.value, calculator.In.rhs);
calc.Wire(op.Out.value, calculator.In.op);

calc.setup();