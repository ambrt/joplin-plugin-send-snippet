import joplin from 'api';
import { MenuItemLocation, ToolbarButtonLocation } from 'api/types';
import { SettingItemType } from 'api/types';

import JoplinData from 'api/JoplinData';
import { ContentScriptType, Path } from 'api/types';


const NUM_RESULTS = 21;
const FOLDERS_REFRESH_INTERVAL = 6000;
const SETTING_SHOW_FOLDERS = 'showFolders';
const SETTING_ALLOW_NEW_NOTES	 = 'allowNewNotes';

let showFolders = false;
let allowNewNotes = false;
let folders = {};

async function getNotes(prefix: string): Promise<any[]> {
	if (prefix === "") {
		const notes = await joplin.data.get(['notes'], {
			fields: ['id', 'title', 'parent_id'],
			order_by: 'updated_time',
			order_dir: 'DESC',
			limit: NUM_RESULTS,
		});
		return notes.items;
	} else {
		const notes = await joplin.data.get(['search'], {
			fields: ['id', 'title', 'parent_id'],
			limit: NUM_RESULTS,
			query: `title:${prefix.trimRight()}*`,
		});
		return notes.items;
	}
}


function escapeTitleText(text: string) {
	return text.replace(/(\[|\])/g, '\\$1');
}


// async function initSettings() {
// 	const SECTION = 'moveSnippet';


// 	await joplin.settings.registerSettings({SETTING_SHOW_FOLDERS: {
// 		public: true,
// 		section: SECTION,
// 		type: SettingItemType.Bool,
// 		value: showFolders,
// 		label: 'Show Notebooks'}})

// 	await joplin.settings.registerSettings({SETTING_ALLOW_NEW_NOTES: {
// 		public: true,
// 		section: SECTION,
// 		type: SettingItemType.Bool,
// 		value: allowNewNotes,
// 		label: 'Allow new Notes',
// 	}})


// }



joplin.plugins.register({
	onStart: async function() {
		
		await joplin.contentScripts.register(
			ContentScriptType.CodeMirrorPlugin,
			'quickLinks',
			'./InlineMoveSnippet.js'
		);

		await joplin.settings.registerSection('moveSnippet', {
			label: 'Send Snippet To Note',
			iconName: 'fas fa-forward',
		});

		await joplin.settings.registerSettings({'moveSnippetSettingPhrase':{
			value: "👈Snippet from",
			type: SettingItemType.String,
			section: 'moveSnippet',
			public: true,
			label: 'Phrase that marks that snippet was moved'
		}});

		await joplin.settings.registerSettings({'moveSnippetSettingStart':{
			value: "Snippet sent to 👉",
			type: SettingItemType.String,
			section: 'moveSnippet',
			public: true,
			label: 'Start of snippet sent'
		}});


		await joplin.settings.registerSettings({'moveSnippetSettingEnd':{
			value: "End of snippet",
			type: SettingItemType.String,
			section: 'moveSnippet',
			public: true,
			label: 'End of snippet sent'
		}});


		await joplin.commands.register({
			name: 'moveSnippetCommand',
			label: 'Send snippet to other note',
			iconName: 'fas fa-forward',
			execute: async () => {
				//alert("from jop")
				let content = (await joplin.commands.execute('selectedText') as string);
				await joplin.commands.execute('editor.execCommand', {
					name: 'moveSnippet',
					args: [content]
				});




			},
		});
		await joplin.views.menus.create('myMoveSnippetMenu', 'Send Snippet', [
			{
				commandName: "moveSnippetCommand",
				accelerator: "Ctrl+Shift+M"
			},
		]);

		//focus
		//type and hints on type
		//enter

		await joplin.contentScripts.onMessage('quickLinks', async (message: any) => {
			const selectedNoteIds = await joplin.workspace.selectedNoteIds();
			const noteId = selectedNoteIds[0];
			if(message.command=='moveSnippetToNote'){
				
				let snippetFrom = await joplin.settings.value("moveSnippetSettingPhrase")
				let snippetStart = await joplin.settings.value("moveSnippetSettingStart")
				let snippetEnd = await joplin.settings.value("moveSnippetSettingEnd")
				
				const activeNote = await joplin.workspace.selectedNote();
				let activeTitle = activeNote.title
				let activeId = activeNote.id

				const targetNote =  await joplin.data.get(['notes', message.targetId], {fields:['title', 'body', 'id']});
				let targetBody = targetNote.body
				let targetId = targetNote.id

				let newBody
				newBody = `${targetBody}\n\n${snippetFrom} [${escapeTitleText(activeTitle)}](:/${activeId})\n\n${message.content}\n\n ${snippetEnd}.`
				
				//await joplin.data.puft(['notes', noteId], null, { body: "New note body" });
				await joplin.data.put(['notes', message.targetId], null, {body:newBody});

				/*
				const newNote = await joplin.data.post(['notes'], null,
					{
						is_todo: message.todo,
						title: message.title,
						parent_id: activeNotesFolder.id
					});
				*/
				return {newNote: true, prompts:{from:snippetFrom, start:snippetStart, end:snippetEnd}};
			}
			if (message.command === 'getNotes') {
				const prefix = message.prefix;
				let notes = await getNotes(prefix);
				const res =  notes.filter(n => n.id !== noteId).map(n => {
					return {
						id: n.id,
						title: n.title,
						folder: folders[n.parent_id],
					};
				});
				console.log(res)
				return { notes: res, showFolders: showFolders, allowNewNotes: false};
			}
		});







		


	},
});
