// todo: Item
// todo: Editing

import {Circuit, DESCRIBE_LATER, EMPTY_MEM, Bacon} from "../../../../src/lib";

type UUID = string;
function uuid4():UUID {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
		var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
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
	export function keypress(target:EventTarget, key:string) {
		return Bacon.fromEvent<Error, KeyboardEvent>(target, "keypress")
			.filter(event => {
				// note: for FF/IE
				if ("key" in event) {
					return event.key === key;
					// note: for Chrome/Safari
				} else if ("keyIdentifier" in event) {
					return (<any>event).keyIdentifier === key;
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
		descr: "Simple locally stored todo list."
	});

	let resource = todo.Block(DESCRIBE_LATER, {
		Mem: EMPTY_MEM,
		In: {
			restore: todo.In<Todo[]>(DESCRIBE_LATER),
			POST: todo.In<POSTTodo>(DESCRIBE_LATER),
			PUT: todo.In<PUTTodo>(DESCRIBE_LATER),
			DELETE: todo.In<DELETETodo>(DESCRIBE_LATER)
		},
		Out: {
			GET: todo.Out<Todo[]>(DESCRIBE_LATER),
			POST: todo.Out<Todo>(DESCRIBE_LATER),
			PUT: todo.Out<Todo>(DESCRIBE_LATER),
			DELETE: todo.Out<Todo>(DESCRIBE_LATER)
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
					let matchingTodos = todos.filter(todo => todo.id === PUT.id);
					switch (matchingTodos.length) {
						case 0:
							return [todos, new Error(`PUT[${JSON.stringify(PUT)}] is absent from the todo-list`), null];
							break;
						case 1:
							let updatedTodos = todos.map(todo => todo.id !== PUT.id ? todo : {
								id: PUT.id,
								title: "title" in PUT ? PUT.title : todo.title,
								completed: "completed" in PUT ? PUT.completed : todo.completed
							});
							return [updatedTodos, null, updatedTodos.filter(todo => todo.id === PUT.id)[0]];
							break;
						default:
							return [todos, new Error(`PUT[${JSON.stringify(PUT)}] is presented in the todo-list multiple times`), null];
							break;
					}
				},
				[In.DELETE.$], ([todos], DELETE) => {
					let matchingTodos = todos.filter(todo => todo.id === DELETE.id);
					switch (matchingTodos.length) {
						case 0:
							return [todos, new Error(`DELETE[${JSON.stringify(DELETE)}] is absent from the todo-list`), null];
							break;
						case 1:
							return [todos.filter(todo => todo.id !== DELETE.id), null, matchingTodos[0]];
							break;
						default:
							return [todos, new Error(`DELETE[${JSON.stringify(DELETE)}] is presented in the todo-list multiple times`), null];
							break;
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

	let persistence = todo.Block(DESCRIBE_LATER, {
		Mem: () => ({
			label: "todos-circuitry.ts"
		}),
		In: {
			store: todo.In<Todo[]>(DESCRIBE_LATER)
		},
		Out: {
			restore: todo.Out<Todo[]>(DESCRIBE_LATER)
		}
	}, (Mem, In, Out) => {
		Out.restore.$ = Bacon
			.constant<Error, string>(localStorage.getItem(Mem.label) || "[]")
			.map<Todo[]>(JSON.parse)
			.toEventStream();
	})
		.Effect<Todo[]>({
		title: "Persistence",
		descr: "Your app should dynamically persist the todos to localStorage. If the framework has capabilities for persisting data (e.g. Backbone.sync), use that, otherwise vanilla localStorage. If possible, use the keys id, title, completed for each item. Make sure to use this format for the localStorage name: todos-[framework]. Editing mode should not be persisted."
	}, (In, Out) => In.store, (Mem, store) => {
		localStorage.setItem(Mem.label, JSON.stringify(store));
	});

	let widget = todo.Block(DESCRIBE_LATER, {
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
			GET: todo.In<Todo[]>(DESCRIBE_LATER),
			POST: todo.In<Todo>(DESCRIBE_LATER),
			PUT: todo.In<Todo>(DESCRIBE_LATER),
			DELETE: todo.In<Todo>(DESCRIBE_LATER)
		},
		Out: {
			POST: todo.Out<POSTTodo>(DESCRIBE_LATER),
			editing: todo.Out<{id:UUID; phaze:Editing}>(DESCRIBE_LATER),
			PUT: todo.Out<PUTTodo>(DESCRIBE_LATER),
			DELETE: todo.Out<DELETETodo>(DESCRIBE_LATER),
			tab: todo.Out<Tab>(DESCRIBE_LATER),
			filtered: todo.Out<{show:UUID[]; hide:UUID[]}>(DESCRIBE_LATER)
		}
	}, (Mem, In, Out) => {
		Out.POST.$ = F.keypress(Mem.DOM.newTodo, "Enter")
			.map(event => (<HTMLInputElement>event.target).value)
			.filter(title => title.length > 0)
			.map(title => ({title: title}));

		{
			let editingStart = F.mouse<HTMLDivElement>(Mem.DOM.todoList, "dlclick", "DIV", ["view"])
					.map(({parentElement:{dataset:{"id":id}}}) => ({
						id: <string>id,
						phaze: Editing.START
					})),
				editingStop = editingStart.toProperty()
					.sampledBy(F.keypress(window, "ESC"))
					.map(({id}) => ({id: id, phaze: Editing.STOP})),
				toggle = F.mouse<HTMLInputElement>(Mem.DOM.todoList, "click", "INPUT", ["toggle"])
					.map(({checked, parentElement:{parentElement:{dataset:{"id":id}}}}) => {
						return {id: <string>id, completed: checked};
					}),
				toggleAll = In.GET.$.toProperty()
					.sampledBy(F.mouse<HTMLInputElement>(Mem.DOM.toggleAll, "click", "INPUT", ["toggle-all"])
						.map(({checked}) => checked),
					(todos:Todo[], completed) => todos.map(todo => ({
						id: todo.id, completed: completed
					})))
					.flatMap(Bacon.fromArray);
			Out.editing.$ = Bacon.mergeAll([editingStart, editingStop]);
			Out.PUT.$ = Bacon.mergeAll([toggle, toggleAll]);
		}

		{
			let destroy = F.mouse<HTMLButtonElement>(Mem.DOM.todoList, "click", "BUTTON", ["destroy"])
					.map(({parentElement:{parentElement:{dataset}}}) => ({id: <string>dataset["id"]})),
				clearCompleted = In.GET.$.toProperty()
					.sampledBy(Bacon.fromEvent<Error, MouseEvent>(Mem.DOM.clearCompleted, "click"))
					.map(todos => todos.reduce((ids, todo) => {
						return ids.concat(todo.completed ? [{id: todo.id}] : []);
					}, <DELETETodo[]>[]))
					.filter(ids => ids.length > 0)
					.flatMap(Bacon.fromArray);
			Out.DELETE.$ = Bacon.mergeAll([destroy, clearCompleted]);
		}

		{
			let tab = Bacon.mergeAll([
				// note: `.delay(0)` here is to emulate the `start-of-life` moment by pushing onto event loop.
				Bacon.once<Error, boolean>(true).delay(0),
				Bacon.fromEvent<Error, Event, boolean>(window, "popstate", _ => true)
			]).map(_ => {
				let match = document.location.hash.match(/\w+/g);
				if (match === null) {
					return Tab.ALL;
				}
				switch (document.location.hash.match(/\w+/g)[0]) {
					case "active":
						return Tab.ACTIVE;
					case "completed":
						return Tab.COMPLETED;
					default:
						return Tab.ALL;
				}
			});
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
		}
	})
		.Effect<Todo[]>({
		title: "Functionality: No todos",
		descr: "When there are no todos, #main and #footer should be hidden."
	}, (In, Out) => In.GET, (Mem, todos) => {
		if (todos.length === 0) {
			Mem.DOM.main.style.display = "none";
			Mem.DOM.footer.style.display = "none";
		} else {
			Mem.DOM.main.style.display = "inherit";
			Mem.DOM.footer.style.display = "inherit";
		}
	})
		.Effect<Todo[]>({
		title: "Functionality: Mark all as complete",
		descr: `This checkbox toggles all the todos to the same state as itself. Make sure to clear the checked state after the the "Clear completed" button is clicked. The "Mark all as complete" checkbox should also be updated when single todo items are checked/unchecked. Eg. When all the todos are checked it should also get checked.`
	}, (In, Out) => In.GET, (Mem, todos) => {
		let toggleAll = Mem.DOM.toggleAll;
		toggleAll.checked = todos.every(({completed}) => completed);
		if (toggleAll.checked) {
			toggleAll.setAttribute("checked", "checked");
		} else {
			toggleAll.removeAttribute("checked");
		}
	})
		.Effect<Todo[]>({
		title: "Functionality: Clear completed button",
		descr: "Removes completed todos when clicked. Should be hidden when there are no completed todos."
	}, (In, Out) => In.GET, (Mem, todos) => {
		Mem.DOM.clearCompleted.style.display = todos.every(({completed}) => !completed) ? "none" : "inherit";
	})
		.Effect<Todo[]>({
		title: "Functionality: Counter",
		descr: "Displays the number of active todos in a pluralized form. Make sure the number is wrapped by a <strong> tag. Also make sure to pluralize the item word correctly: 0 items, 1 item, 2 items. Example: 2 items left"
	}, (In, Out) => In.GET, (Mem, todos) => {
		let active = todos.filter(({completed}) => !completed),
			s = active.length === 1 ? "" : "s";
		Mem.DOM.todoCount.innerHTML = `<strong>${active.length}</strong> item${s} left`;
	})
		.Effect<Todo>({
		title: "Functionality: New todo",
		descr: "Make sure to .trim() the input and then check that it's not empty before creating a new todo."
	}, (In, Out) => Out.POST, (Mem, _) => {
		let newTodo = Mem.DOM.newTodo;
		newTodo.value = "";
		newTodo.setAttribute("value", "");
	})
		.Effect<Todo>(DESCRIBE_LATER, (In, Out) => In.POST, (Mem, todo) => {
		let completed = todo.completed ? `class="completed"` : "",
			checked = todo.completed ? `checked="checked"` : "";
		Mem.DOM.todoList.innerHTML += `
<li data-id="${todo.id}" ${completed}>
	<div class="view">
		<input class="toggle" type="checkbox" ${checked}>
		<label>${todo.title}</label>
		<button class="destroy"></button>
	</div>
	<input class="edit" value="${todo.title}">
</li>`;
	})
		.Effect<{id:UUID; phaze:Editing}>(DESCRIBE_LATER, (In, Out) => Out.editing, (Mem, editing) => {
		let {classList} = <HTMLLIElement>Mem.DOM.todoList.querySelector(`[data-id="${editing.id}"]`);
		switch (editing.phaze) {
			case Editing.START:
				classList.add("editing");
				break;
			case Editing.STOP:
				classList.remove("editing");
				break;
		}
	})
		.Effect<Todo>(DESCRIBE_LATER, (In, Out) => In.PUT, (Mem, todo) => {
		let li = <HTMLLIElement>Mem.DOM.todoList.querySelector(`[data-id="${todo.id}"]`),
			toggle = (<HTMLInputElement>li.querySelector(".toggle")),
			edit = (<HTMLInputElement>li.querySelector(".edit"));
		toggle.checked = todo.completed;
		if (todo.completed) {
			toggle.setAttribute("checked", "checked");
		} else {
			toggle.removeAttribute("checked")
		}
		(<HTMLLabelElement>li.querySelector("label")).textContent = todo.title;
		edit.value = todo.title;
		edit.setAttribute("value", todo.title);
		if (todo.completed) {
			li.classList.add("completed");
		} else {
			li.classList.remove("completed");
		}
	})
		.Effect<Todo>(DESCRIBE_LATER, (In, Out) => In.DELETE, (Mem, todo) => {
		let el = <HTMLElement>Mem.DOM.todoList.querySelector(`[data-id="${todo.id}"]`);
		el.parentElement.removeChild(el);
	})
		.Effect<Tab>({
		title: "Functionality: Routing",
		descr: "Routing is required for all frameworks. The following routes should be implemented: #/ (all - default), #/active and #/completed (#!/ is also allowed). When the route changes the todo list should be filtered on a model level and the selected class on the filter links should be toggled. Make sure the active filter is persisted on reload."
	}, (In, Out) => Out.tab, (Mem, tab) => {
		let {all:{classList:all}, active:{classList:active}, completed:{classList:completed}} = Mem.DOM.filters;
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
	}, (In, Out) => Out.filtered, (Mem, {show, hide}) => {
		Array.prototype.slice.call(Mem.DOM.todoList.querySelectorAll("[data-id]")).forEach(el => {
			let id = el.dataset["id"];
			switch (true) {
				case show.indexOf(id) > -1:
					el.style.display = "inherit";
					break;
				case hide.indexOf(id) > -1:
					el.style.display = "none";
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
