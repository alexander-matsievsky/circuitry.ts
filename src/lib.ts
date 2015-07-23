/// <reference path="./DefinitelyTyped/baconjs/baconjs.d.ts"/>
// todo: implement viz.
// todo: implement diagnosis (`console.log` + `WebSocket` viz binding).

/*
 * fixme: `InPort`s (consumers) don't get the first `OutPort`s (producers) values.
 * Now it is patched by
 *   1/ making `bus` eager in `InPort.constructor()`;
 *   2/ delaying the wired `OutPort` in `Circuit.setup()` [ head.wire(tail.wire.delay(0)); ].
 * */

import * as Bacon from "baconjs";
export {Bacon}

function uuid4():string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

let ERROR = {
  MUST_BE_IN_PORT: (box:Descriptor, port:string) => port + " in " + box.toString() + " must be of type `InPort`",
  MUST_BE_OUT_PORT: (box:Descriptor, port:string) => port + " in " + box.toString() + " must be of type `OutPort`",
  MUST_BELONG_TO_BOX: (box:Descriptor, ports:Descriptor[]) => "ports {" + ports.map(port => port.toString()).join("") + "} must belong to box " + box
};

export interface IDescriptor {
  title:string;
  descr:string;
}
export const DESCRIBE_LATER = {title: "", descr: ""};
export const EMPTY_MEM = () => ({});

export interface Blueprint {
  box: {[id:string]:{
    descriptor: Descriptor
    inPorts: string[]
    outPorts: string[]
    sideEffects: string[]
  }}
  inPort: {[id:string]:{
    descriptor:Descriptor
    box:string
  }}
  outPort: {[id:string]:{
    descriptor:Descriptor
    box:string
  }}
  sideEffect: {[id:string]:{
    descriptor:Descriptor
    box:string
  }}
  wire: {[id:string]:{
    head:string
    tail:string
  }}
}

export class Descriptor {
  private id_:string;
  private title_:string;
  private description_:string;

  constructor(title:string, description:string) {
    this.id_ = uuid4();
    this.title_ = title;
    this.description_ = description;
  }

  get id() {
    return this.id_;
  }

  get title() {
    return this.title_;
  }

  get description() {
    return this.description_;
  }

  toString() {
    return this.id + "[" + this.title + "]";
  }
}

export class InPort<A> {
  bus:Bacon.Bus<Error, A>;

  constructor(public descriptor:Descriptor) {
    this.bus = new Bacon.Bus<Error, A>();
    this.bus.onValue(() => null);
  }

  get $() {
    return this.bus;
  }

  wire(that:Bacon.EventStream<Error, A>) {
    this.bus.plug(that);
  }
}

export class OutPort<A> {
  bus:Bacon.Bus<Error, A>;

  constructor(public descriptor:Descriptor) {
    this.bus = new Bacon.Bus<Error, A>();
  }

  set $(s:Bacon.EventStream<Error, A>) {
    this.bus.plug(s);
  }

  get wire() {
    return this.bus;
  }
}

export class Wire<A> {
  public descriptor:Descriptor;

  constructor(public head:InPort<A>, public tail:OutPort<A>) {
    this.descriptor = new Descriptor("no-label-for-wire", "no-description-for-wire");
  }
}

export class Block<Memory, InPortMap, OutPortMap> {
  public descriptor:Descriptor;
  private Mem:() => Memory;
  private In_:InPortMap;
  private Out_:OutPortMap;
  private process:(Mem:Memory, In:InPortMap, Out:OutPortMap) => void;
  private effects:{
    descriptor: Descriptor;
    port: InPort<any>|OutPort<any>;
    effect: (Mem:Memory, value:any) => void;
  }[];

  constructor(descriptor:Descriptor, Mem:() => Memory, In:InPortMap, Out:OutPortMap, process:(Mem:Memory, In:InPortMap, Out:OutPortMap) => void) {
    this.descriptor = descriptor;
    this.Mem = Mem;
    this.In_ = In;
    this.Out_ = Out;
    this.process = process;
    this.effects = [];
  }

  setup() {
    let Mem = this.Mem();
    this.effects.forEach(({port, effect}) => {
      port.bus.onValue(value => {
        effect(Mem, value);
      });
    });
    this.process(Mem, this.In, this.Out);
  }

  get In():InPortMap {
    return this.In_;
  }

  get Out():OutPortMap {
    return this.Out_;
  }

  Effect<A>(descr:IDescriptor, sensitivity:(In:InPortMap, Out:OutPortMap) => InPort<A>|OutPort<A>, effect:(Mem:Memory, value:A) => void):Block<Memory, InPortMap, OutPortMap> {
    let port = sensitivity(this.In_, this.Out_);
    if (port instanceof InPort) {
      let inPorts = Object.keys(this.In_).map(name => this.In_[name]);
      if (inPorts.indexOf(port) === -1) {
        throw new Error(ERROR.MUST_BELONG_TO_BOX(this.descriptor, [port.descriptor]));
      }
    } else {
      let outPorts = Object.keys(this.Out_).map(name => this.Out_[name]);
      if (outPorts.indexOf(port) === -1) {
        throw new Error(ERROR.MUST_BELONG_TO_BOX(this.descriptor, [port.descriptor]));
      }
    }
    this.effects.push({
      descriptor: new Descriptor(descr.title, descr.descr),
      port: port,
      effect: effect
    });
    return this;
  }

  /*
   toBlueprint() {
   return {
   box: {
   descriptor: this.descriptor,
   inPorts: Object.keys(this.In).map(name => {
   let port = this.In[name];
   return port.descriptor.id;
   }),
   outPorts: Object.keys(this.Out).map(name => {
   let port = this.Out[name];
   return port.descriptor.id;
   }),
   effects: this.effects.map(se => se.descriptor.id)
   },
   inPorts: Object.keys(this.In).map(name => {
   return {
   descriptor: this.In[name].descriptor,
   box: this.descriptor.id
   };
   }),
   outPorts: Object.keys(this.Out).map(name => {
   return {
   descriptor: this.Out[name].descriptor,
   box: this.descriptor.id
   };
   }),
   effects: this.effects.map(se => {
   return {
   descriptor: se.descriptor,
   box: this.descriptor.id
   };
   })
   };
   }
   */
}

export class Circuit {
  public descriptor:Descriptor;
  private blocks:{[id:string]:Block<any,any,any>} = {};
  private wires:{[id:string]:Wire<any>} = {};

  constructor(descriptor:IDescriptor) {
    this.descriptor = new Descriptor(descriptor.title, descriptor.descr);
  }

  In<A>(descr:IDescriptor):InPort<A> {
    return new InPort<A>(new Descriptor(descr.title, descr.descr));
  }

  Out<A>(descr:IDescriptor):OutPort<A> {
    return new OutPort<A>(new Descriptor(descr.title, descr.descr));
  }

  Block<Memory, InPortMap, OutPortMap>(descr:IDescriptor, {Mem, In, Out}:{
    Mem:() => Memory; In:InPortMap; Out:OutPortMap
  }, process:(Mem:Memory, In:InPortMap, Out:OutPortMap) => void):Block<Memory, InPortMap, OutPortMap> {
    let descriptor = new Descriptor(descr.title, descr.descr);
    Object.keys(In).forEach(name => {
      if (!(In[name] instanceof InPort)) {
        throw new Error(ERROR.MUST_BE_IN_PORT(descriptor, name));
      }
    });
    Object.keys(Out).forEach(name => {
      if (!(Out[name] instanceof OutPort)) {
        throw new Error(ERROR.MUST_BE_OUT_PORT(descriptor, name));
      }
    });
    let box = new Block(descriptor, Mem, In, Out, process);
    this.blocks[box.descriptor.id] = box;
    return box;
  }

  Wire<A>(tail:OutPort<A>, head:InPort<A>):void {
    let wire = new Wire(head, tail);
    this.wires[wire.descriptor.id] = wire;
  }

  setup() {
    Object.keys(this.wires).forEach(id => {
      let {head, tail} = this.wires[id];
      head.wire(tail.wire.delay(0));
    });
    Object.keys(this.blocks).forEach(id => {
      this.blocks[id].setup();
    });
  }

  /*
   toBlueprint():Blueprint {
   return Object.keys(this.blocks).reduce((obj, id) => {
   let box = this.blocks[id], blueprint = box.toBlueprint();
   obj.box[id] = blueprint.box;
   blueprint.inPorts.forEach(inPort => {
   obj.inPort[inPort.descriptor.id] = inPort;
   });
   blueprint.outPorts.forEach(outPort => {
   obj.outPort[outPort.descriptor.id] = outPort;
   });
   blueprint.sideEffects.forEach(sideEffect => {
   obj.sideEffect[sideEffect.descriptor.id] = sideEffect;
   });
   return obj;
   }, {
   box: <{[id:string]:{
   descriptor: Descriptor
   inPorts: string[]
   outPorts: string[]
   sideEffects: string[]
   }}>{},
   inPort: <{[id:string]:{
   descriptor:Descriptor
   box:string
   }}>{},
   outPort: <{[id:string]:{
   descriptor:Descriptor
   box:string
   }}>{},
   sideEffect: <{[id:string]:{
   descriptor:Descriptor
   box:string
   }}>{},
   wire: Object.keys(this.wires).reduce((wire, id) => {
   let $wire = this.wires[id];
   wire[id] = {
   head: $wire.head.descriptor.id,
   tail: $wire.tail.descriptor.id
   };
   return wire;
   }, <{[id:string]:{head:string;tail:string;}}>{})
   });
   }
   */
}