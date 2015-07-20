import {Circuit, Bacon} from "../../src/lib";

enum Operator { PLUS, MINUS, TIMES, DIVISION }

let cir = new Circuit({
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

let lhs = cir.Block({
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
    value: cir.Out<number>({title: "LHS operand", descr: "LHS operand"})
  }
}, (Mem, In, Out) => {
  Out.value.$ = decodeOperand(Mem.keyboard, Mem.initialValue);
});
lhs.Effect({
  title: "LHS operand printer",
  descr: "Prints left-hand-side operand to display"
}, lhs.Out.value, (Mem, value) => {
  Mem.display.innerHTML = `${value}`;
});

let rhs = cir.Block({
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
    value: cir.Out<number>({title: "RHS operand", descr: "RHS operand"})
  }
}, (Mem, In, Out) => {
  Out.value.$ = decodeOperand(Mem.keyboard, Mem.initialValue);
});
rhs.Effect({
  title: "RHS operand printer",
  descr: "Prints right-hand-side operand to display"
}, rhs.Out.value, (Mem, n) => {
  Mem.display.innerHTML = `${n}`;
});

let op = cir.Block({
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
    value: cir.Out<Operator>({title: "Operator", descr: ""}),
    symbol: cir.Out<string>({title: "Operator symbol", descr: ""})
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
});
op.Effect({
  title: "Operator printer",
  descr: ""
}, op.Out.symbol, (Mem, symbol) => {
  Mem.display.innerHTML = symbol;
});

let calculator = cir.Block({
  title: "Calculator",
  descr: "Simple binary operation calculator"
}, {
  Mem: () => ({
    display: <HTMLSpanElement>document.querySelector("form[name=calculator] fieldset[name=result] code")
  }),
  In: {
    lhs: cir.In<number>({title: "A", descr: "First operand"}),
    rhs: cir.In<number>({title: "B", descr: "Second operand"}),
    op: cir.In<Operator>({title: "O", descr: "Operand"})
  },
  Out: {
    c: cir.Out<number>({title: "C", descr: "Result"})
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
});
calculator.Effect({
  title: "Result printer",
  descr: ""
}, calculator.Out.c, (Mem, c) => {
  Mem.display.innerHTML = `${c}`;
});

cir.Wire(lhs.Out.value, calculator.In.lhs);
cir.Wire(rhs.Out.value, calculator.In.rhs);
cir.Wire(op.Out.value, calculator.In.op);

cir.setup();