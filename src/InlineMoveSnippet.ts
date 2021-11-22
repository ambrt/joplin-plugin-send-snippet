import joplin from "api";

interface Hint {
	text: string;
	hint: Function;
	displayText?: string;
	render?: Function;
}






module.exports = {
	default: function (context: any) {


		function NewNoteHint(prefix: string, todo: boolean) {
			let description = "New Note";

			if (todo)
				description = "New Task";

			const newNoteHint: Hint = {
				text: prefix,
				hint: async (cm, data, completion) => {
					const from = completion.from || data.from;
					from.ch -= 2;

					const response = await context.postMessage({ command: 'createNote', title: prefix, todo: todo });
					cm.replaceRange(`[${prefix}](:/${response.newNote.id})`, from, cm.getCursor(), "complete");
				},
			};

			newNoteHint.render = (elem, _data, _completion) => {
				const p = elem.ownerDocument.createElement('div');
				p.setAttribute('style', 'width: 100%; display:table;');
				elem.appendChild(p);
				p.innerHTML = `
						<div style="display:table-cell; padding-right: 5px">${prefix}</div>
						<div style="display:table-cell; text-align: right;"><small><em>${description}</em></small></div>
						`
			};
			return newNoteHint;
		}

		const buildHints = async (prefix: string) => {

			const response = await context.postMessage({ command: 'getNotes', prefix: prefix });

			let hints: Hint[] = [];

			const notes = response.notes;
			for (let i = 0; i < notes.length; i++) {
				const note = notes[i];
				const hint: Hint = {
					text: note.title,
					hint: async (cm, data, completion) => {
						const from = completion.from || data.from;
						from.ch -= 2;
						let content = cm.getSelection()
						let target = note.title
						//alert(`Send ${content} to ${target}`)
						let start = cm.getCursor(true)
						let end = cm.getCursor(false)

						//message to index
						const response = await context.postMessage({ command: 'moveSnippetToNote', content: content, targetId: note.id });
						let snippetFrom = response.prompts.from
						let snippetStart = response.prompts.start
						let snippetEnd = response.prompts.end
						cm.replaceRange(`${snippetStart} [${note.title}](:/${note.id})\n${content}\n${snippetEnd}.`, start, end, "complete");
						// cm.replaceRange(`[${note.title}](:/${note.id})`, from, cm.getCursor(), "complete");
					},
				};
				if (response.showFolders) {
					const folder = !!note.folder ? note.folder : "unknown";
					hint.render = (elem, _data, _completion) => {
						const p = elem.ownerDocument.createElement('div');
						p.setAttribute('style', 'width: 100%; display:table;');
						elem.appendChild(p);
						p.innerHTML = `
						<div style="display:table-cell; padding-right: 5px">${note.title}</div>
						<div style="display:table-cell; text-align: right;"><small><em>In ${folder}</em></small></div>
						`
					};
				} else {
					hint.displayText = note.title;
				}
				hints.push(hint);
			}

			if (response.allowNewNotes && prefix) {
				hints.push(NewNoteHint(prefix, false));
				hints.push(NewNoteHint(prefix, true));
			}

			return hints;
		}

		const plugin = function (CodeMirror) {



			(function (mod) {

				mod(CodeMirror);
			})(function (CodeMirror) {
				"use strict";

				var HINT_ELEMENT_CLASS = "CodeMirror-hint";
				var ACTIVE_HINT_ELEMENT_CLASS = "CodeMirror-hint-active";

				// This is the old interface, kept around for now to stay
				// backwards-compatible.
				CodeMirror.showHint = function (cm, getHints, options) {
					if (!getHints) return cm.showHint(options);
					if (options && options.async) getHints.async = true;
					var newOpts = { hint: getHints };
					if (options) for (var prop in options) newOpts[prop] = options[prop];
					return cm.showHint(newOpts);
				};

				CodeMirror.defineExtension("showHint", function (options) {

					options = parseOptions(this, this.getCursor("start"), options);
					var selections = this.listSelections()
					//if (selections.length > 1) return;
					// By default, don't allow completion when something is selected.
					// A hint function can have a `supportsSelection` property to
					// indicate that it can handle selections.
					//if (this.somethingSelected()) {
					//if (!options.hint.supportsSelection) return;
					// Don't try with cross-line selections
					//for (var i = 0; i < selections.length; i++)
					//if (selections[i].head.line != selections[i].anchor.line) return;
					//}
					console.log("in hint deeper")
					if (this.state.completionActive) this.state.completionActive.close();
					var completion = this.state.completionActive = new Completion(this, options);
					if (!completion.options.hint) return;

					CodeMirror.signal(this, "startCompletion", this);
					completion.update(true);
				});
				CodeMirror.defineExtension("closeHint", function () {
					if (this.state.completionActive) this.state.completionActive.close()
				})

				function Completion(cm, options) {
					this.cm = cm;
					this.options = options;
					this.widget = null;
					this.debounce = 0;
					this.tick = 0;
					this.startPos = this.cm.getCursor("start");
					this.startLen = this.cm.getLine(this.startPos.line).length - this.cm.getSelection().length;

					var self = this;
					cm.on("cursorActivity", this.activityFunc = function () { self.cursorActivity(); });
				}

				var requestAnimationFrame = window.requestAnimationFrame || function (fn) {
					return setTimeout(fn, 1000 / 60);
				};
				var cancelAnimationFrame = window.cancelAnimationFrame || clearTimeout;

				Completion.prototype = {
					close: function () {
						if (!this.active()) return;
						this.cm.state.completionActive = null;
						this.tick = null;
						this.cm.off("cursorActivity", this.activityFunc);

						if (this.widget && this.data) CodeMirror.signal(this.data, "close");
						if (this.widget) this.widget.close();
						CodeMirror.signal(this.cm, "endCompletion", this.cm);
					},

					active: function () {
						return this.cm.state.completionActive == this;
					},

					pick: function (data, i) {
						var completion = data.list[i];
						if (completion.hint) completion.hint(this.cm, data, completion);
						else this.cm.replaceRange(getText(completion), completion.from || data.from,
							completion.to || data.to, "complete");
						CodeMirror.signal(data, "pick", completion);
						this.close();
					},

					cursorActivity: function () {
						if (this.debounce) {
							cancelAnimationFrame(this.debounce);
							this.debounce = 0;
						}

						var pos = this.cm.getCursor(), line = this.cm.getLine(pos.line);
						if (pos.line != this.startPos.line || line.length - pos.ch != this.startLen - this.startPos.ch ||
							pos.ch < this.startPos.ch || this.cm.somethingSelected() ||
							(pos.ch && this.options.closeCharacters.test(line.charAt(pos.ch - 1)))) {
							this.close();
						} else {
							var self = this;
							this.debounce = requestAnimationFrame(function () { self.update(); });
							if (this.widget) this.widget.disable();
						}
					},

					update: function (first) {
						if (this.tick == null) return;
						if (!this.options.hint.async) {
							this.finishUpdate(this.options.hint(this.cm, this.options), first);
						} else {
							var myTick = ++this.tick, self = this;
							this.options.hint(this.cm, function (data) {
								if (self.tick == myTick) self.finishUpdate(data, first);
							}, this.options);
						}
					},

					finishUpdate: function (data, first) {
						if (this.data) CodeMirror.signal(this.data, "update");
						if (data && this.data && CodeMirror.cmpPos(data.from, this.data.from)) data = null;
						this.data = data;

						var picked = (this.widget && this.widget.picked) || (first && this.options.completeSingle);
						if (this.widget) this.widget.close();
						if (data && data.list.length) {
							if (picked && data.list.length == 1) {
								this.pick(data, 0);
							} else {
								// @ts-ignore
								this.widget = new Widget(this, data);
								CodeMirror.signal(data, "shown");
							}
						}
					}
				};

				function parseOptions(cm, pos, options) {
					var editor = cm.options.hintOptions;
					var out = {};
					for (var prop in defaultOptions) out[prop] = defaultOptions[prop];
					if (editor) for (var prop in editor)
						if (editor[prop] !== undefined) out[prop] = editor[prop];
					if (options) for (var prop in options)
						if (options[prop] !== undefined) out[prop] = options[prop];
					// @ts-ignore
					if (out.hint.resolve) out.hint = out.hint.resolve(cm, pos)
					return out;
				}

				function getText(completion) {
					if (typeof completion == "string") return completion;
					else return completion.text;
				}

				function buildKeyMap(completion, handle) {
					var baseMap = {
						Up: function () { handle.moveFocus(-1); },
						Down: function () { handle.moveFocus(1); },
						PageUp: function () { handle.moveFocus(-handle.menuSize() + 1, true); },
						PageDown: function () { handle.moveFocus(handle.menuSize() - 1, true); },
						Home: function () { handle.setFocus(0); },
						End: function () { handle.setFocus(handle.length - 1); },
						Enter: handle.pick,
						Tab: handle.pick,
						Esc: handle.close
					};
					var custom = completion.options.customKeys;
					var ourMap = custom ? {} : baseMap;
					function addBinding(key, val) {
						var bound;
						if (typeof val != "string")
							bound = function (cm) { return val(cm, handle); };
						// This mechanism is deprecated
						else if (baseMap.hasOwnProperty(val))
							bound = baseMap[val];
						else
							bound = val;
						ourMap[key] = bound;
					}
					if (custom)
						for (var key in custom) if (custom.hasOwnProperty(key))
							addBinding(key, custom[key]);
					var extra = completion.options.extraKeys;
					if (extra)
						for (var key in extra) if (extra.hasOwnProperty(key))
							addBinding(key, extra[key]);
					return ourMap;
				}

				function getHintElement(hintsElement, el) {
					while (el && el != hintsElement) {
						if (el.nodeName.toUpperCase() === "LI" && el.parentNode == hintsElement) return el;
						el = el.parentNode;
					}
				}

				function Widget(completion, data) {
					this.completion = completion;
					this.data = data;
					this.picked = false;
					var widget = this, cm = completion.cm;

					var hints = this.hints = document.createElement("ul");
					hints.className = "CodeMirror-hints";
					this.selectedHint = data.selectedHint || 0;

					var completions = data.list;
					for (var i = 0; i < completions.length; ++i) {
						var elt = hints.appendChild(document.createElement("li")), cur = completions[i];
						var className = HINT_ELEMENT_CLASS + (i != this.selectedHint ? "" : " " + ACTIVE_HINT_ELEMENT_CLASS);
						if (cur.className != null) className = cur.className + " " + className;
						elt.className = className;
						if (cur.render) cur.render(elt, data, cur);
						else elt.appendChild(document.createTextNode(cur.displayText || getText(cur)));
						// @ts-ignore
						elt.hintId = i;
					}

					var pos = cm.cursorCoords(completion.options.alignWithWord ? data.from : null);
					var left = pos.left, top = pos.bottom, below = true;
					hints.style.left = left + "px";
					hints.style.top = top + "px";
					// If we're at the edge of the screen, then we want the menu to appear on the left of the cursor.
					var winW = window.innerWidth || Math.max(document.body.offsetWidth, document.documentElement.offsetWidth);
					var winH = window.innerHeight || Math.max(document.body.offsetHeight, document.documentElement.offsetHeight);
					(completion.options.container || document.body).appendChild(hints);
					var box = hints.getBoundingClientRect(), overlapY = box.bottom - winH;
					if (overlapY > 0) {
						var height = box.bottom - box.top, curTop = pos.top - (pos.bottom - box.top);
						if (curTop - height > 0) { // Fits above cursor
							hints.style.top = (top = pos.top - height) + "px";
							below = false;
						} else if (height > winH) {
							hints.style.height = (winH - 5) + "px";
							hints.style.top = (top = pos.bottom - box.top) + "px";
							var cursor = cm.getCursor();
							if (data.from.ch != cursor.ch) {
								pos = cm.cursorCoords(cursor);
								hints.style.left = (left = pos.left) + "px";
								box = hints.getBoundingClientRect();
							}
						}
					}
					var overlapX = box.right - winW;
					if (overlapX > 0) {
						if (box.right - box.left > winW) {
							hints.style.width = (winW - 5) + "px";
							overlapX -= (box.right - box.left) - winW;
						}
						hints.style.left = (left = pos.left - overlapX) + "px";
					}

					cm.addKeyMap(this.keyMap = buildKeyMap(completion, {
						moveFocus: function (n, avoidWrap) { widget.changeActive(widget.selectedHint + n, avoidWrap); },
						setFocus: function (n) { widget.changeActive(n); },
						menuSize: function () { return widget.screenAmount(); },
						length: completions.length,
						close: function () { completion.close(); },
						pick: function () { widget.pick(); },
						data: data
					}));

					if (completion.options.closeOnUnfocus) {
						var closingOnBlur;
						cm.on("blur", this.onBlur = function () { closingOnBlur = setTimeout(function () { completion.close(); }, 100); });
						cm.on("focus", this.onFocus = function () { clearTimeout(closingOnBlur); });
					}

					var startScroll = cm.getScrollInfo();
					cm.on("scroll", this.onScroll = function () {
						var curScroll = cm.getScrollInfo(), editor = cm.getWrapperElement().getBoundingClientRect();
						var newTop = top + startScroll.top - curScroll.top;
						var point = newTop - (window.pageYOffset || (document.documentElement || document.body).scrollTop);
						if (!below) point += hints.offsetHeight;
						if (point <= editor.top || point >= editor.bottom) return completion.close();
						hints.style.top = newTop + "px";
						hints.style.left = (left + startScroll.left - curScroll.left) + "px";
					});

					CodeMirror.on(hints, "dblclick", function (e) {
						var t = getHintElement(hints, e.target || e.srcElement);
						if (t && t.hintId != null) { widget.changeActive(t.hintId); widget.pick(); }
					});

					CodeMirror.on(hints, "click", function (e) {
						var t = getHintElement(hints, e.target || e.srcElement);
						if (t && t.hintId != null) {
							widget.changeActive(t.hintId);
							if (completion.options.completeOnSingleClick) widget.pick();
						}
					});

					CodeMirror.on(hints, "mousedown", function () {
						setTimeout(function () { cm.focus(); }, 20);
					});

					CodeMirror.signal(data, "select", completions[0], hints.firstChild);
					return true;
				}

				Widget.prototype = {
					close: function () {
						if (this.completion.widget != this) return;
						this.completion.widget = null;
						this.hints.parentNode.removeChild(this.hints);
						this.completion.cm.removeKeyMap(this.keyMap);

						var cm = this.completion.cm;
						if (this.completion.options.closeOnUnfocus) {
							cm.off("blur", this.onBlur);
							cm.off("focus", this.onFocus);
						}
						cm.off("scroll", this.onScroll);
					},

					disable: function () {
						this.completion.cm.removeKeyMap(this.keyMap);
						var widget = this;
						this.keyMap = { Enter: function () { widget.picked = true; } };
						this.completion.cm.addKeyMap(this.keyMap);
					},

					pick: function () {
						this.completion.pick(this.data, this.selectedHint);
					},

					changeActive: function (i, avoidWrap) {
						if (i >= this.data.list.length)
							i = avoidWrap ? this.data.list.length - 1 : 0;
						else if (i < 0)
							i = avoidWrap ? 0 : this.data.list.length - 1;
						if (this.selectedHint == i) return;
						var node = this.hints.childNodes[this.selectedHint];
						node.className = node.className.replace(" " + ACTIVE_HINT_ELEMENT_CLASS, "");
						node = this.hints.childNodes[this.selectedHint = i];
						node.className += " " + ACTIVE_HINT_ELEMENT_CLASS;
						if (node.offsetTop < this.hints.scrollTop)
							this.hints.scrollTop = node.offsetTop - 3;
						else if (node.offsetTop + node.offsetHeight > this.hints.scrollTop + this.hints.clientHeight)
							this.hints.scrollTop = node.offsetTop + node.offsetHeight - this.hints.clientHeight + 3;
						CodeMirror.signal(this.data, "select", this.data.list[this.selectedHint], node);
					},

					screenAmount: function () {
						return Math.floor(this.hints.clientHeight / this.hints.firstChild.offsetHeight) || 1;
					}
				};

				function applicableHelpers(cm, helpers) {
					if (!cm.somethingSelected()) return helpers
					var result = []
					for (var i = 0; i < helpers.length; i++)
						if (helpers[i].supportsSelection) result.push(helpers[i])
					return result
				}

				function resolveAutoHints(cm, pos) {
					var helpers = cm.getHelpers(pos, "hint"), words
					if (helpers.length) {
						var async = false, resolved
						for (var i = 0; i < helpers.length; i++) if (helpers[i].async) async = true
						if (async) {
							resolved = function (cm, callback, options) {
								var app = applicableHelpers(cm, helpers)
								function run(i, result) {
									if (i == app.length) return callback(null)
									var helper = app[i]
									if (helper.async) {
										helper(cm, function (result) {
											if (result) callback(result)
											// @ts-ignore
											else run(i + 1)
										}, options)
									} else {
										var result = helper(cm, options)
										if (result) callback(result)
										// @ts-ignore
										else run(i + 1)
									}
								}
								// @ts-ignore
								run(0)
							}
							resolved.async = true
						} else {
							resolved = function (cm, options) {
								var app = applicableHelpers(cm, helpers)
								for (var i = 0; i < app.length; i++) {
									var cur = app[i](cm, options)
									if (cur && cur.list.length) return cur
								}
							}
						}
						resolved.supportsSelection = true
						return resolved
					} else if (words = cm.getHelper(cm.getCursor(), "hintWords")) {
						return function (cm) { return CodeMirror.hint.fromList(cm, { words: words }) }
					} else if (CodeMirror.hint.anyword) {
						return function (cm, options) { return CodeMirror.hint.anyword(cm, options) }
					} else {
						return function () { }
					}
				}

				CodeMirror.registerHelper("hint", "auto", {
					resolve: resolveAutoHints
				});

				CodeMirror.registerHelper("hint", "fromList", function (cm, options) {
					var cur = cm.getCursor(), token = cm.getTokenAt(cur);
					var to = CodeMirror.Pos(cur.line, token.end);
					if (token.string && /\w/.test(token.string[token.string.length - 1])) {
						var term = token.string, from = CodeMirror.Pos(cur.line, token.start);
					} else {
						// @ts-ignore
						var term = "", from = to;
					}
					var found = [];
					for (var i = 0; i < options.words.length; i++) {
						var word = options.words[i];
						if (word.slice(0, term.length) == term)
							found.push(word);
					}

					if (found.length) return { list: found, from: from, to: to };
				});

				CodeMirror.commands.autocomplete = CodeMirror.showHint;

				var defaultOptions = {
					hint: CodeMirror.hint.auto,
					completeSingle: true,
					alignWithWord: true,
					closeCharacters: /[\s()\[\]{};:>,]/,
					closeOnUnfocus: true,
					completeOnSingleClick: false,
					container: null,
					customKeys: null,
					extraKeys: null
				};

				CodeMirror.defineOption("hintOptions", null);
			});


			CodeMirror.registerHelper('hint', 'ajax', (mirror, callback, cb) => {
				var cur = mirror.getCursor();
				var range = mirror.findWordAt(cur);
				console.log(mirror)
				console.log(callback)
				console.log(cb)
				console.log(CodeMirror.hint)


				buildHints(CodeMirror.hint.ajax.prefix).then(hints => {

					callback({
						list: hints,
						from: range.anchor,
						to: range.head
					});

				});

			});



			CodeMirror.defineExtension('moveSnippet', function (something) {







				//alert(something)
				let editor = this
				let doc = editor.getDoc()
				let cm = this
				var widgets = []

				/* hints */
				function showSuggs(prefix, line, ch) {




					setTimeout(function () {
						CodeMirror.hint.ajax.async = true;
						CodeMirror.hint.ajax.prefix = prefix
						console.log("asdf")
						var options = {
							hint: CodeMirror.hint.ajax, completeSingle: false,
							closeOnUnfocus: true,
							async: true,
							closeCharacters: /[()\[\]{};:>,]/,
							completeOnSingleClick: true
						};
						cm.showHint(options);
						console.log("Show hints ")


					}, 100);
				}


				function updateHints() {
					editor.operation(function () {
						for (var i = 0; i < widgets.length; ++i)
							editor.removeLineWidget(widgets[i]);
						widgets.length = 0;

						//JSHINT(editor.getValue());
						//for (var i = 0; i < JSHINT.errors.length; ++i) {
						//var err = JSHINT.errors[i];
						//if (!err) continue;
						//alert(doc.getSelection())
						let { line, ch } = doc.getCursor()
						//alert(JSON.stringify(line) + " " + JSON.stringify(ch))





						let lineNumber = doc.getLineNumber(line)
						var msg = document.createElement("div");

						let lineWidget = editor.addLineWidget(line - 1, msg, { coverGutter: false, noHScroll: true })

						var icon = msg.appendChild(document.createElement("span"));
						//msg.appendChild(document.createTextNode("asdf"));
						var element = document.createElement('input');
						element.type = "text";
						element.placeholder = "New Input";
						element.onkeyup = function (e) {
							var code = (e.keyCode || e.which);
							if (e.key === "Escape") {
								document.getElementById("close-id").click()
								setTimeout(() => {
									console.log("close hint")

									cm.closeHint()
								}, 200);


							}

							showSuggs(element.value, line, ch)
						};

						msg.appendChild(element);




						var remove = document.createElement('a');
						remove.id = "close-id"
						remove.innerHTML = " Close";
						remove.onclick = function () { editor.removeLineWidget(lineWidget) };
						msg.appendChild(remove);
						widgets.push(lineWidget);
						setTimeout(function () { element.focus() }, 100)

						//showSuggs(element.value, line, ch)








						//}
					});
					var info = editor.getScrollInfo();
					var after = editor.charCoords({ line: editor.getCursor().line + 1, ch: 0 }, "local").top;
					if (info.top + info.clientHeight < after)
						editor.scrollTo(null, after - info.clientHeight + 3);





				}



				updateHints()


			});
			if (false) {
				CodeMirror.defineOption('quickLinks', false, function (cm, value, prev) {
					if (!value) return;
					let editor = cm
					cm.on('inputRead', async function (cm1, change) {

						if (!cm1.state.completionActive && cm.getTokenAt(cm.getCursor()).string === '@@') {
							/*
							var widgets = []
							function updateHints() {
								editor.operation(function () {
									for (var i = 0; i < widgets.length; ++i)
										editor.removeLineWidget(widgets[i]);
									widgets.length = 0;
	
									//JSHINT(editor.getValue());
									//for (var i = 0; i < JSHINT.errors.length; ++i) {
									//var err = JSHINT.errors[i];
									//if (!err) continue;
									var msg = document.createElement("div");
									var icon = msg.appendChild(document.createElement("span"));
									//msg.appendChild(document.createTextNode("asdf"));
									var element = document.createElement('input');
									element.type = "text";
									element.placeholder = "New Input";
									msg.appendChild(element)
	
	
									let lineWidget = editor.addLineWidget(change.from.line - 1, msg, { coverGutter: false, noHScroll: true })
									var remove = document.createElement('a');
									remove.innerHTML = " Close"
									remove.onclick = function () { editor.removeLineWidget(lineWidget) }
									msg.appendChild(remove)
									widgets.push(lineWidget);
									//}
								});
								var info = editor.getScrollInfo();
								var after = editor.charCoords({ line: editor.getCursor().line + 1, ch: 0 }, "local").top;
								if (info.top + info.clientHeight < after)
									editor.scrollTo(null, after - info.clientHeight + 3);
							}
	
	
							updateHints()
							*/
							const start = { line: change.from.line, ch: change.from.ch + 1 };

							const hint = function (cm, callback) {
								const cursor = cm.getCursor();
								let prefix = cm.getRange(start, cursor) || '';

								buildHints(prefix).then(hints => {
									callback({
										list: hints,
										from: { line: change.from.line, ch: change.from.ch + 1 },
										to: { line: change.to.line, ch: change.to.ch + 1 },
									});
								});
							};

							setTimeout(function () {
								CodeMirror.showHint(cm, hint, {
									completeSingle: false,
									closeOnUnfocus: true,
									async: true,
									closeCharacters: /[()\[\]{};:>,]/
								});
							}, 10);
						}
					});
				});
			}

		};

		return {

			plugin: plugin,
			codeMirrorResources: [
				//'addon/hint/show-hint',
			],
			codeMirrorOptions: {
				// 'quickLinks': true,
				// 'quickLinks2': true,
			},
			assets: function () {
				return [
					{ name: './show-hint.css' },
				]
			}

		}
	}
}
