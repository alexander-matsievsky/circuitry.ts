/// <reference path="../typings/tsd.d.ts"/>
// todo: implement static viz.
// todo: implement dinamic viz (`console.log` + `WebSocket` binding).
// todo: swap `node-11.d.ts` to `node.d.ts` in `baconjs.d.ts`

import * as Bacon from "baconjs";
import {v4 as uuidV4} from "node-uuid";
export {Bacon}

let ERROR = {
    MUST_BE_IN_PORT: (box:Descriptor, port:Descriptor) => `port:${port} in block:${box} must be *InPort*`,
    MUST_BE_OUT_PORT: (box:Descriptor, port:Descriptor) => `port:${port} in block:${box} must be *OutPort*`,
    MUST_BELONG_TO_BOX: (box:Descriptor, port:Descriptor) => `port:${port} must belong to block:${box}`
};

export const DESCRIBE_LATER = {title: "", descr: ""};
export const EMPTY_MEM = () => ({});

export interface Descr {
    title:string;
    descr:string;
}
class Descriptor {
    id:string;
    title:string;
    description:string;

    constructor({title, descr}:Descr) {
        this.id = uuidV4();
        this.title = title;
        this.description = descr;
        Object.freeze(this);
    }

    toString() {
        return `${this.id}[${this.title}]`;
    }
}
export interface Blueprint {
    blocks:{[id:string]:{
        descriptor:Descriptor
        inPorts:string[]
        outPorts:string[]
        sideEffects:string[]
    }}
    inPorts:{[id:string]:{
        descriptor:Descriptor
        symbol:string
    }}
    outPorts:{[id:string]:{
        descriptor:Descriptor
        symbol:string
    }}
    sideEffects:{[id:string]:{
        descriptor:Descriptor
        effect:string
        port:string
    }}
    wires:{[id:string]:{
        head:string
        tail:string
    }}
}
let transform = (object, f) => {
        return Object.keys(object).reduce((transform, id) => {
            let [key, value] = f(id, object[id]);
            transform[key] = value;
            return transform;
        }, {});
    },
    merge = (objects) => {
        return objects.reduce((merge, object) => {
            Object.keys(object).forEach(key => {
                merge[key] = object[key];
            });
            return merge;
        }, {});
    };

class InPort<A> {
    constructor(public descriptor:Descriptor, private getRHSStream:<B, Stream>(inPort:InPort<B>) => Stream) {
        Object.freeze(this.descriptor);
    }

    get $() {
        return this.getRHSStream<A, Bacon.EventStream<Error, A>>(this);
    }
}

class OutPort<A> {
    constructor(public descriptor:Descriptor, private assignLHSStream:<B, Stream>(outPort:OutPort<B>, stream:Stream) => void) {
        Object.freeze(this.descriptor);
    }

    set $(stream:Bacon.EventStream<Error, A>) {
        this.assignLHSStream<A, Bacon.EventStream<Error, A>>(this, stream);
    }
}

class Wire<A> {
    public descriptor:Descriptor;

    constructor(public tail:OutPort<A>, public head:InPort<A>) {
        this.descriptor = new Descriptor({
            title: "Wire",
            descr: `A wire from port:${tail} to port:${head}.`
        });
        Object.freeze(this.descriptor);
    }
}

class Block<Memory, InPortMap, OutPortMap> {
    private effects:{
        descriptor: Descriptor;
        port: InPort<any>|OutPort<any>;
        effect: (Mem:Memory, value:any) => void;
    }[] = [];

    constructor(private circuit:Circuit, public descriptor:Descriptor, private Mem:() => Memory, public In:InPortMap, public Out:OutPortMap, private process:(Mem:Memory, In:InPortMap, Out:OutPortMap) => void) {
        Object.freeze(this.descriptor);
        Object.freeze(this.In);
        Object.freeze(this.Out);
    }

    Effect<A>(descr:Descr, sensitivity:(In:InPortMap, Out:OutPortMap) => InPort<A>|OutPort<A>, effect:(Mem:Memory, value:A) => void):Block<Memory, InPortMap, OutPortMap> {
        let port = sensitivity(this.In, this.Out);
        switch (true) {
            case port instanceof InPort:
                let inPorts = Object.keys(this.In).map(name => this.In[name]);
                if (inPorts.indexOf(port) === -1) {
                    throw new Error(ERROR.MUST_BELONG_TO_BOX(this.descriptor, port.descriptor));
                }
                break;
            case port instanceof OutPort:
                let outPorts = Object.keys(this.Out).map(name => this.Out[name]);
                if (outPorts.indexOf(port) === -1) {
                    throw new Error(ERROR.MUST_BELONG_TO_BOX(this.descriptor, port.descriptor));
                }
                break;
        }
        this.effects.push({
            descriptor: new Descriptor(descr),
            port: port,
            effect: <(Mem:Memory, value:A) => void>effect
        });
        return this;
    }

    setup<A>(registerPortEffect:(port:InPort<A> | OutPort<A>, f:(A) => void) => void) {
        let Mem = this.Mem();
        this.effects.forEach(({port, effect}) => {
            registerPortEffect(port, value => {
                effect(Mem, value);
            });
        });
        this.process(Mem, this.In, this.Out);
    }

    get blueprint() {
        let inPorts = transform(this.In, (symbol, inPort) => [
                inPort.descriptor.id,
                {
                    descriptor: inPort.descriptor,
                    symbol: symbol
                }
            ]),
            outPorts = transform(this.Out, (symbol, inPort) => [
                inPort.descriptor.id,
                {
                    descriptor: inPort.descriptor,
                    symbol: symbol
                }
            ]),
            sideEffects = this.effects.reduce((sideEffects, effect) => {
                sideEffects[effect.descriptor.id] = {
                    descriptor: effect.descriptor,
                    port: effect.port.descriptor.id,
                    effect: effect.effect.toString()
                };
                return sideEffects;
            }, {});
        return {
            blocks: {
                [this.descriptor.id]: {
                    descriptor: this.descriptor,
                    inPorts: Object.keys(inPorts),
                    outPorts: Object.keys(outPorts),
                    sideEffects: Object.keys(sideEffects)
                }
            },
            inPorts: inPorts,
            outPorts: outPorts,
            sideEffects: sideEffects
        };
    }
}

export class Circuit {
    public descriptor:Descriptor;
    private blocks:{[id:string]:Block<any,any,any>} = {};
    private inPorts:{[id:string]:InPort<any>} = {};
    private outPorts:{[id:string]:OutPort<any>} = {};
    private buses:{[id:string]:Bacon.Bus<any, any>} = {};
    private wires:{[id:string]:Wire<any>} = {};

    constructor(descr:Descr) {
        this.descriptor = new Descriptor(descr);
        Object.freeze(this.descriptor);
    }

    In<A>(descr:Descr):InPort<A> {
        let port = new InPort<A>(new Descriptor(descr), (inPort:InPort<A>) => {
            return <Bacon.Bus<Error, A>>this.buses[inPort.descriptor.id];
        });
        this.inPorts[port.descriptor.id] = port;
        return port;
    }

    Out<A>(descr:Descr):OutPort<A> {
        var port = new OutPort<A>(new Descriptor(descr), (outPort:OutPort<A>, stream:Bacon.EventStream<Error, A>) => {
            (<Bacon.Bus<Error, A>>this.buses[outPort.descriptor.id]).plug(stream);
        });
        this.outPorts[port.descriptor.id] = port;
        return port;
    }

    Block<Memory, InPortMap, OutPortMap>(descr:Descr, {Mem, In, Out}:{
        Mem:() => Memory; In:InPortMap; Out:OutPortMap
    }, process:(Mem:Memory, In:InPortMap, Out:OutPortMap) => void):Block<Memory, InPortMap, OutPortMap> {
        let descriptor = new Descriptor(descr);
        Object.keys(In).forEach(name => {
            if (!(In[name] instanceof InPort)) {
                throw new Error(ERROR.MUST_BE_IN_PORT(descriptor, In[name].descriptor));
            }
        });
        Object.keys(Out).forEach(name => {
            if (!(Out[name] instanceof OutPort)) {
                throw new Error(ERROR.MUST_BE_OUT_PORT(descriptor, Out[name].descriptor));
            }
        });
        let box = new Block(this, descriptor, Mem, In, Out, process);
        this.blocks[box.descriptor.id] = box;
        return box;
    }

    Wire<A>(tail:OutPort<A>, head:InPort<A>):void {
        let wire = new Wire(tail, head);
        this.wires[wire.descriptor.id] = wire;
    }

    Connect<MemoryT, InPortMapT, OutPortMapT, MemoryH, InPortMapH, OutPortMapH>(tailBlock:Block<MemoryT, InPortMapT, OutPortMapT>, headBlock:Block<MemoryH, InPortMapH, OutPortMapH>) {
        let connect = {
            wire: <A>(fT:(OutPortMapT) => OutPort<A>, fH:(InPortMapT) => InPort<A>) => {
                this.Wire(fT(tailBlock.Out), fH(headBlock.In));
                return connect;
            }
        };
        return connect;
    }

    setup() {
        // todo: figure out if this is the best way to enable eagerness: `.onValue(() => null)` and `.delay(0)`
        [].concat(Object.keys(this.inPorts), Object.keys(this.outPorts)).forEach(id => {
            let bus = new Bacon.Bus();
            this.buses[id] = bus;
            bus.onValue(() => null);
        });
        Object.keys(this.wires).forEach(id => {
            let {head, tail} = this.wires[id];
            (<Bacon.Bus<any, any>>this.buses[head.descriptor.id]).plug(
                <Bacon.Bus<any, any>>this.buses[tail.descriptor.id].delay(0)
            );
        });
        Object.keys(this.blocks).forEach(id => {
            this.blocks[id].setup((port:InPort<any> | OutPort<any>, f) => {
                (<Bacon.EventStream<any, any>>this.buses[port.descriptor.id]).onValue(f);
            });
        });
    }

    get blueprint():Blueprint {
        let {blocks, inPorts, outPorts, sideEffects} = Object.keys(this.blocks)
                .reduce((reduce, id) => {
                    let blueprint = this.blocks[id].blueprint;
                    return {
                        blocks: merge([reduce.blocks, blueprint.blocks]),
                        inPorts: merge([reduce.inPorts, blueprint.inPorts]),
                        outPorts: merge([reduce.outPorts, blueprint.outPorts]),
                        sideEffects: merge([reduce.sideEffects, blueprint.sideEffects])
                    };
                }, {blocks: {}, inPorts: {}, outPorts: {}, sideEffects: {}}),
            wires = <{[id:string]:{tail:string; head:string}}>transform(this.wires, (id, wire) => [
                id,
                {
                    head: wire.head.descriptor.id,
                    tail: wire.tail.descriptor.id
                }
            ]);
        return {
            blocks: blocks,
            inPorts: inPorts,
            outPorts: outPorts,
            sideEffects: sideEffects,
            wires: wires
        };
    }
}