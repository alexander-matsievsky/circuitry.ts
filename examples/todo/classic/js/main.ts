import {Circuit, EMPTY_MEM, Bacon} from "../../../../src/lib";

type UUID = string;
function uuid4():UUID {
   return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c == "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
   });
}

interface Todo {
   id:UUID
   title:string
   completed:boolean
}
interface POSTTodo {
   title:string
}
interface PUTTodo {
   id:UUID
   title?:string
   completed?:boolean
}
interface DELETETodo {
   id:UUID
}

enum Tab {ALL, ACTIVE, COMPLETED}
enum Editing {START, STOP}

module F {
   export function keypress(target:EventTarget, keys:string[], keydown = false) {
      return Bacon.fromEvent<Error, KeyboardEvent>(target, keydown ? "keydown" : "keypress")
         .filter(event => {
            // note: for FF/IE
            if ("key" in event) {
               return keys.indexOf(event.key) > -1;
               // note: for Chrome/Safari
            } else if ("keyIdentifier" in event) {
               return keys.indexOf((<any>event).keyIdentifier) > -1;
            } else {
               throw new Error("UNREACHABLE!");
            }
         });
   }

   export function mouse<A extends HTMLElement>(target:EventTarget, eventName:string, tagName:string, classes:string[]):Bacon.EventStream<Error, A> {
      return Bacon.fromEvent<Error, MouseEvent>(target, eventName)
         .filter(event => {
            let {tagName:tagName_, classList} = <HTMLElement>event.target;
            return tagName_ === tagName && classes.every(classList.contains.bind(classList));
         })
         .map(event => <A>(event.target));
   }
}

window.addEventListener("load", () => {
   let todo = new Circuit({
      title: "Todo application",
      descr: "Simple locally stored todo-list."
   });

   let resource = todo.Block({
      title: "Todo-list REST-like resource",
      descr: `
* restores todo-list from \`restore\`;
* accepts, validates, incorporates todo-list \`POST\` updates;
* accepts, validates, incorporates todo-list \`PUT\` updates;
* accepts, validates, incorporates todo-list \`DELETE\` updates;
* aggregates todo-list \`POST\`, \`PUT\`, \`DELETE\` updates and tracks the current state with \`GET\`.
`
   }, {
      Mem: EMPTY_MEM,
      In: {
         restore: todo.In<Todo[]>({
            title: "Initial todo-list at the start-up time",
            descr: "An initial todo-list at the start-up time"
         }),
         POST: todo.In<POSTTodo>({
            title: "Todo-list `POST` update",
            descr: "Creates a new todo."
         }),
         PUT: todo.In<PUTTodo>({
            title: "Todo-list `PUT` update",
            descr: "Updates an existing todo, which *MUST* exist in the todo-list."
         }),
         DELETE: todo.In<DELETETodo>({
            title: "Todo-list `DELETE` update",
            descr: "Deletes an existing todo, which *MUST* exist in the todo-list."
         })
      },
      Out: {
         GET: todo.Out<Todo[]>({
            title: "Todo `GET`ter",
            descr: "A currently actual full todo-list with full info."
         }),
         POST: todo.Out<Todo>({
            title: "Todo `POST`er",
            descr: "A newly created todo-list item with full info."
         }),
         PUT: todo.Out<Todo>({
            title: "Todo `PUT`ter",
            descr: "An updated todo-list item with full info."
         }),
         DELETE: todo.Out<Todo>({
            title: "Todo `DELETE`r",
            descr: "A deleted todo-list item with full info."
         })
      }
   }, (Mem, In, Out) => {
      let POST = Bacon.mergeAll(
            In.POST.$.map(POST => ({
               id: uuid4(),
               title: POST.title,
               completed: false
            })),
            In.restore.$.flatMap(Bacon.fromArray)
         ),
         update = Bacon.update<Error, Todo, PUTTodo, DELETETodo, [Todo[], Error, Todo]>([[], null, null],
            [POST], ([todos], POST) => {
               return [todos.concat(POST), null, POST];
            },
            [In.PUT.$], ([todos], PUT) => {
               switch (todos.filter(({id}) => id === PUT.id).length) {
                  case 0:
                     return [todos, new Error(`PUT[${JSON.stringify(PUT)}] is absent from the todo-list`), null];
                  case 1:
                     let updatedTodos = todos.map(todo => todo.id !== PUT.id ? todo : {
                        id: PUT.id,
                        title: "title" in PUT ? PUT.title : todo.title,
                        completed: "completed" in PUT ? PUT.completed : todo.completed
                     });
                     return [updatedTodos, null, updatedTodos.filter(todo => todo.id === PUT.id)[0]];
                  default:
                     return [todos, new Error(`PUT[${JSON.stringify(PUT)}] is presented in the todo-list multiple times`), null];
               }
            },
            [In.DELETE.$], ([todos], DELETE) => {
               let matchingTodos = todos.filter(({id}) => id === DELETE.id);
               switch (matchingTodos.length) {
                  case 0:
                     return [todos, new Error(`DELETE[${JSON.stringify(DELETE)}] is absent from the todo-list`), null];
                  case 1:
                     return [todos.filter(todo => todo.id !== DELETE.id), null, matchingTodos[0]];
                  default:
                     return [todos, new Error(`DELETE[${JSON.stringify(DELETE)}] is presented in the todo-list multiple times`), null];
               }
            }
         )
            .flatMap<[Todo[], Todo]>(([todos, error, todo]) => {
            return error !== null ? new Bacon.Error(error) : [todos, todo];
         });

      Out.GET.$ = update.map(([todos, _]) => todos);
      Out.POST.$ = Bacon.when<Error, [Todo[], Todo], [Todo[], Todo], [Todo[], Todo], Todo>(
         [update, <any>POST], ([_, POST]) => POST,
         [update, <any>In.PUT.$], _ => null,
         [update, <any>In.DELETE.$], _ => null
      ).filter(_ => _ !== null);
      Out.PUT.$ = Bacon.when<Error, [Todo[], Todo], [Todo[], Todo], [Todo[], Todo], Todo>(
         [update, <any>POST], _ => null,
         [update, <any>In.PUT.$], ([_, PUT]) => PUT,
         [update, <any>In.DELETE.$], _ => null
      ).filter(_ => _ !== null);
      Out.DELETE.$ = Bacon.when<Error, [Todo[], Todo], [Todo[], Todo], [Todo[], Todo], Todo>(
         [update, <any>POST], _ => null,
         [update, <any>In.PUT.$], _ => null,
         [update, <any>In.DELETE.$], ([_, DELETE]) => DELETE
      ).filter(_ => _ !== null);
   });

   let persistence = todo.Block({
      title: "Todo persister",
      descr: `
* stores todo-list updates;
* restores todo-list between sessions through \`localStorage\`;
`
   }, {
      Mem: () => ({
         label: "todos-circuitry.ts"
      }),
      In: {
         store: todo.In<Todo[]>({
            title: "Todo-list to store in a `localStorage`",
            descr: "A todo-list to store in a `localStorage`."
         })
      },
      Out: {
         restore: todo.Out<Todo[]>({
            title: "Todo-list restored from a `localStorage`",
            descr: "A todo-list restored from a `localStorage`."
         })
      }
   }, (Mem, In, Out) => {
      Out.restore.$ = Bacon
         .constant<Error, string>(localStorage.getItem(Mem.label) || "[]")
         .map<Todo[]>(JSON.parse)
         .toEventStream();
   })
      .Effect<Todo[]>({
      title: "Functionality: Persistence",
      descr: `Your app should dynamically persist the todos to localStorage. If the framework has capabilities for persisting data (e.g. Backbone.sync), use that, otherwise vanilla localStorage. If possible, use the keys \`id\`, \`title\`, \`completed\` for each item. Make sure to use this format for the localStorage name: \`todos-[framework]\`. Editing mode should not be persisted.`
   }, (In, Out) => In.store, ({label}, store) => {
      localStorage.setItem(label, JSON.stringify(store));
   });

   let widget = todo.Block({
      title: "Todo widget",
      descr: "The widget implements the required [Functionality](https://github.com/tastejs/todomvc/blob/master/app-spec.md#functionality)"
   }, {
      Mem: () => {
         let header = <HTMLDivElement>document.querySelector("header.header"),
            main = <HTMLDivElement>document.querySelector("section.main"),
            footer = <HTMLDivElement>document.querySelector("footer.footer"),
            filters = <HTMLUListElement>footer.querySelector("ul.filters");
         return {
            DOM: {
               header: header,
               newTodo: <HTMLInputElement>header.querySelector("input.new-todo"),
               main: main,
               toggleAll: <HTMLInputElement>main.querySelector("input.toggle-all"),
               todoList: <HTMLUListElement>main.querySelector("ul.todo-list"),
               footer: footer,
               todoCount: <HTMLSpanElement>footer.querySelector("span.todo-count"),
               clearCompleted: <HTMLButtonElement>footer.querySelector("button.clear-completed"),
               filters: {
                  _: filters,
                  all: <HTMLLinkElement>filters.querySelector(`[href="#/"]`),
                  active: <HTMLLinkElement>filters.querySelector(`[href="#/active"]`),
                  completed: <HTMLLinkElement>filters.querySelector(`[href="#/completed"]`),
               }
            }
         };
      },
      In: {
         GET: todo.In<Todo[]>({
            title: "Todo `GET`ter",
            descr: "A currently actual full todo-list with full info."
         }),
         POST: todo.In<Todo>({
            title: "Todo `POST`er",
            descr: "A newly created todo-list item with full info."
         }),
         PUT: todo.In<Todo>({
            title: "Todo `PUT`ter",
            descr: "An updated todo-list item with full info."
         }),
         DELETE: todo.In<Todo>({
            title: "Todo `DELETE`r",
            descr: "A deleted todo-list item with full info."
         })
      },
      Out: {
         POST: todo.Out<POSTTodo>({
            title: "Todo-list `POST` update",
            descr: "Creates a new todo."
         }),
         PUT: todo.Out<PUTTodo>({
            title: "Todo-list `PUT` update",
            descr: "Updates an existing todo."
         }),
         DELETE: todo.Out<DELETETodo>({
            title: "Todo-list `DELETE` update",
            descr: "Deletes an existing todo."
         }),
         editing: todo.Out<{id:UUID; phaze:Editing}>({
            title: "Todo-list item's editing process",
            descr: `Denotes which todo (by \`id\`) is in the editing process in which \`phaze\`. \`phaze\` can be:
* START - begin editing the todo, display this fact in the UI;
* STOP - finish editing the todo, display this fact in the UI.
`
         }),
         tab: todo.Out<Tab>({
            title: "Todo-list selected filter-tab",
            descr: `Denotes the currently active filter tab. Can be:
* ALL - display all todos;
* ACTIVE - display non-\`completed\` todos only;
* COMPLETED - display \`completed\` todos only.
`
         }),
         filtered: todo.Out<{show:UUID[]; hide:UUID[]}>({
            title: "Todo-list items' visibility",
            descr: `Denotes which todos to \`show\` or \`hide\` in the todo-list.`
         })
      }
   }, (Mem, In, Out) => {
      let {DOM:{todoList}} = Mem,
         editingStart = F.mouse<HTMLDivElement>(todoList, "dblclick", "LABEL", [])
            .map(({parentElement:{parentElement:{dataset:{"id":id}}}}) => {
               return {id: <UUID>id, phaze: Editing.START};
            }),
         editingCancel = editingStart.toProperty()
            .sampledBy(Bacon.mergeAll<Error, boolean>([
               F.keypress(todoList, ["U+001B", "Esc", "Escape"], true).map(true),
               Bacon.fromBinder<Error, FocusEvent>(sink => {
                  todoList.addEventListener("blur", sink, true);
                  return () => void todoList.removeEventListener("blur", sink);
               }).map(true)
            ]))
            .map(({id}) => ({id: id, phaze: Editing.STOP})),
         editingAccept = editingStart.toProperty()
            .sampledBy<UUID, {id:UUID; acceptId:UUID}>(F.keypress(todoList, ["U+000D", "Enter"], true)
            .map(event => {
               let input = <HTMLInputElement>event.target,
                  {parentElement:{dataset:{"id":id}}} = input;
               return <UUID>id;
            }), ({id}, acceptId:UUID) => ({id: id, acceptId: acceptId})),
         editingValue = editingAccept
            .filter(({id, acceptId}) => id === acceptId)
            .map(({id}) => {
               let input = <HTMLInputElement>todoList.querySelector(`[data-id="${id}"] input.edit`);
               return {
                  id: id,
                  title: input.value,
                  previousTitle: input.getAttribute("value")
               };
            }),
         toggle = F.mouse<HTMLInputElement>(todoList, "click", "INPUT", ["toggle"])
            .map(({checked, parentElement:{parentElement:{dataset:{"id":id}}}}) => {
               return {id: <UUID>id, completed: checked};
            }),
         toggleAll = In.GET.$.toProperty()
            .sampledBy(
            F.mouse<HTMLInputElement>(Mem.DOM.toggleAll, "click", "INPUT", ["toggle-all"]).map(({checked}) => checked),
            (todos:Todo[], completed) => todos.map(({id}) => {
               return {id: id, completed: completed};
            })
         ).flatMap(Bacon.fromArray),
         destroy = F.mouse<HTMLButtonElement>(todoList, "click", "BUTTON", ["destroy"])
            .map(({parentElement:{parentElement:{dataset:{"id":id}}}}) => ({id: <UUID>id})),
         clearCompleted = In.GET.$.toProperty()
            .sampledBy(Bacon.fromEvent<Error, MouseEvent>(Mem.DOM.clearCompleted, "click"))
            .map(todos => todos.reduce((ids, {id, completed}) => {
               return ids.concat(completed ? [{id: id}] : []);
            }, <DELETETodo[]>[]))
            .filter(ids => ids.length > 0)
            .flatMap(Bacon.fromArray),
         tab = Bacon.mergeAll([
            // note: `.delay(0)` here is to emulate the `start-of-life` moment by pushing onto event loop.
            Bacon.once<Error, boolean>(true).delay(0),
            Bacon.fromEvent<Error, Event, boolean>(window, "popstate", _ => true)
         ]).map(_ => {
            let match = document.location.hash.match(/\w+/g);
            if (match === null) {
               return Tab.ALL;
            }
            switch (match[0]) {
               case "active":
                  return Tab.ACTIVE;
               case "completed":
                  return Tab.COMPLETED;
               default:
                  return Tab.ALL;
            }
         });

      Out.POST.$ = F.keypress(Mem.DOM.newTodo, ["U+000D", "Enter"])
         .map(event => (<HTMLInputElement>event.target).value)
         .filter(title => title.length > 0)
         .map(title => ({title: title}));
      Out.PUT.$ = Bacon.mergeAll([toggle, toggleAll,
         editingValue
            .filter(({title, previousTitle}) => title.length > 0 && title !== previousTitle)
            .map<PUTTodo>(({id, title}) => ({id: id, title: title}))
      ]);
      Out.DELETE.$ = Bacon.mergeAll([destroy, clearCompleted,
         editingValue
            .filter(({title, previousTitle}) => title.length === 0)
            .map<DELETETodo>(({id, title}) => ({id: id}))
      ]);
      Out.editing.$ = Bacon.mergeAll([editingStart, editingCancel,
         editingAccept.map(({id}) => ({id: id, phaze: Editing.STOP}))
      ]);
      Out.tab.$ = tab;
      Out.filtered.$ = In.GET.$.toProperty().sampledBy(
         // note: need to `.throttle(0)` here to push the `filtered` onto event loop after rendering the item got from `In.GET.$`.
         Bacon.mergeAll([tab, tab.toProperty().sampledBy<Todo[]>(In.GET.$.throttle(0))]),
         (todos:Todo[], tab) => {
            let {active, completed} = todos.reduce(({active, completed}:{active:UUID[]; completed:UUID[]}, {id, completed:todoCompleted}) => {
               return todoCompleted ? {
                  active: active,
                  completed: completed.concat(id)
               } : {
                  active: active.concat(id),
                  completed: completed
               };
            }, {active: [], completed: []});
            switch (tab) {
               case Tab.ALL:
                  return {
                     show: active.concat(completed),
                     hide: []
                  };
               case Tab.ACTIVE:
                  return {
                     show: active,
                     hide: completed
                  };
               case Tab.COMPLETED:
                  return {
                     show: completed,
                     hide: active
                  };
            }
         });
   })
      .Effect<Todo[]>({
      title: "Functionality: No todos",
      descr: "When there are no todos, \`#main\` and \`#footer\` should be hidden."
   }, (In, Out) => In.GET, ({DOM:{main, footer}}, {length}) => {
      if (length === 0) {
         main.style.display = "none";
         footer.style.display = "none";
      } else {
         main.style.display = "inherit";
         footer.style.display = "inherit";
      }
   })
      .Effect<Todo[]>({
      title: "Functionality: Mark all as complete",
      descr: `This checkbox toggles all the todos to the same state as itself. Make sure to clear the checked state after the the "Clear completed" button is clicked. The "Mark all as complete" checkbox should also be updated when single todo items are checked/unchecked. Eg. When all the todos are checked it should also get checked.`
   }, (In, Out) => In.GET, ({DOM:{toggleAll}}, todos) => {
      toggleAll.checked = todos.every(({completed}) => completed);
      if (toggleAll.checked) {
         toggleAll.setAttribute("checked", "checked");
      } else {
         toggleAll.removeAttribute("checked");
      }
   })
      .Effect<Todo[]>({
      title: "Functionality: Clear completed button",
      descr: `Removes completed todos when clicked. Should be hidden when there are no completed todos.`
   }, (In, Out) => In.GET, ({DOM:{clearCompleted:{style}}}, todos) => {
      style.display = todos.every(({completed}) => !completed) ? "none" : "inherit";
   })
      .Effect<Todo[]>({
      title: "Functionality: Counter",
      descr: `Displays the number of active todos in a pluralized form. Make sure the number is wrapped by a \`<strong>\` tag. Also make sure to pluralize the \`item\` word correctly: \`0 items\`, \`1 item\`, \`2 items\`. Example: **2** items left`
   }, (In, Out) => In.GET, ({DOM:{todoCount}}, todos) => {
      let {length} = todos.filter(({completed}) => !completed),
         s = length === 1 ? "" : "s";
      todoCount.innerHTML = `<strong>${length}</strong> item${s} left`;
   })
      .Effect<Todo>({
      title: "Functionality: New todo",
      descr: `New todos are entered in the input at the top of the app. The input element should be focused when the page is loaded preferably using the \`autofocus\` input attribute. Pressing Enter creates the todo, appends it to the todo list and clears the input. Make sure to \`.trim()\` the input and then check that it's not empty before creating a new todo.`
   }, (In, Out) => Out.POST, ({DOM:{newTodo}}, _) => {
      newTodo.value = "";
      newTodo.setAttribute("value", "");
   })
      .Effect<Todo>({
      title: "Todo `POST`er",
      descr: "Creates a view for a newly posted todo. Every later update goes through `PUT`ter."
   }, (In, Out) => In.POST, ({DOM:{todoList}}, {id, title, completed}) => {
      let $completed = completed ? `class="completed"` : "",
         checked = completed ? `checked="checked"` : "";
      todoList.innerHTML += `
<li data-id="${id}" ${$completed}>
	<div class="view">
		<input class="toggle" type="checkbox" ${checked}>
		<label>${title}</label>
		<button class="destroy"></button>
	</div>
	<input class="edit" value="${title}">
</li>`;
   })
      .Effect<{id:UUID; phaze:Editing}>({
      title: "Functionality: Editing",
      descr: `When editing mode is activated it will hide the other controls and bring forward an input that contains the todo title, which should be focused (\`.focus()\`). The edit should be saved on both blur and enter, and the \`editing\` class should be removed. Make sure to \`.trim()\` the input and then check that it's not empty. If it's empty the todo should instead be destroyed. If escape is pressed during the edit, the edit state should be left and any changes be discarded.`
   }, (In, Out) => Out.editing, ({DOM:{todoList}}, {id, phaze}) => {
      let li = <HTMLLIElement>todoList.querySelector(`[data-id="${id}"]`),
         {classList} = li,
         edit = (<HTMLInputElement>li.querySelector("input.edit"));
      switch (phaze) {
         case Editing.START:
            classList.add("editing");
            edit.focus();
            break;
         case Editing.STOP:
            classList.remove("editing");
            edit.value = edit.getAttribute("value");
            break;
      }
   })
      .Effect<Todo>({
      title: "Todo `PUT`ter",
      descr: "Updates a view for every todo update after `POST`er."
   }, (In, Out) => In.PUT, ({DOM:{todoList}}, {id, title, completed}) => {
      let li = <HTMLLIElement>todoList.querySelector(`[data-id="${id}"]`),
         toggle = (<HTMLInputElement>li.querySelector(".toggle")),
         edit = (<HTMLInputElement>li.querySelector(".edit"));
      toggle.checked = completed;
      if (completed) {
         toggle.setAttribute("checked", "checked");
      } else {
         toggle.removeAttribute("checked")
      }
      (<HTMLLabelElement>li.querySelector("label")).textContent = title;
      edit.value = title;
      edit.setAttribute("value", title);
      if (completed) {
         li.classList.add("completed");
      } else {
         li.classList.remove("completed");
      }
   })
      .Effect<Todo>({
      title: "Todo `DELETE`r",
      descr: "Deletes a view for a deleted todo."
   }, (In, Out) => In.DELETE, ({DOM:{todoList}}, {id}) => {
      let el = <HTMLElement>todoList.querySelector(`[data-id="${id}"]`);
      el.parentElement.removeChild(el);
   })
      .Effect<Tab>({
      title: "Functionality: Routing",
      descr: `Routing is required for all frameworks. Use the built-in capabilities if supported, otherwise use the  [Flatiron Director](https://github.com/flatiron/director) routing library located in the \`/assets\` folder. The following routes should be implemented: \`#/\` (all - default), \`#/active\` and \`#/completed\` (\`#!/\` is also allowed). When the route changes the todo list should be filtered on a model level and the \`selected\` class on the filter links should be toggled. When an item is updated while in a filtered state, it should be updated accordingly. E.g. if the filter is \`Active\` and the item is checked, it should be hidden. Make sure the active filter is persisted on reload.`
   }, (In, Out) => Out.tab, ({DOM:{filters:{all:{classList:all}, active:{classList:active}, completed:{classList:completed}}}}, tab) => {
      switch (tab) {
         case Tab.ALL:
            all.add("selected");
            active.remove("selected");
            completed.remove("selected");
            break;
         case Tab.ACTIVE:
            all.remove("selected");
            active.add("selected");
            completed.remove("selected");
            break;
         case Tab.COMPLETED:
            all.remove("selected");
            active.remove("selected");
            completed.add("selected");
      }
   })
      .Effect<{show:UUID[]; hide:UUID[]}>({
      title: "Functionality: Routing",
      descr: "Routing is required for all frameworks. The following routes should be implemented: #/ (all - default), #/active and #/completed (#!/ is also allowed). When the route changes the todo list should be filtered on a model level and the selected class on the filter links should be toggled. When an item is updated while in a filtered state, it should be updated accordingly. E.g. if the filter is Active and the item is checked, it should be hidden."
   }, (In, Out) => Out.filtered, ({DOM:{todoList}}, {show, hide}) => {
      Array.prototype.slice.call(todoList.querySelectorAll("[data-id]"))
         .forEach(({style, dataset:{"id":id}}) => {
            switch (true) {
               case show.indexOf(id) > -1:
                  style.display = "inherit";
                  break;
               case hide.indexOf(id) > -1:
                  style.display = "none";
                  break;
            }
         });
   });

   todo.Wire(resource.Out.GET, persistence.In.store);
   todo.Wire(persistence.Out.restore, resource.In.restore);
   todo.Wire(widget.Out.POST, resource.In.POST);
   todo.Wire(widget.Out.PUT, resource.In.PUT);
   todo.Wire(widget.Out.DELETE, resource.In.DELETE);
   todo.Wire(resource.Out.GET, widget.In.GET);
   todo.Wire(resource.Out.POST, widget.In.POST);
   todo.Wire(resource.Out.PUT, widget.In.PUT);
   todo.Wire(resource.Out.DELETE, widget.In.DELETE);

   todo.setup();
});
