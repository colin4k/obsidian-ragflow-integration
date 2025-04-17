import { App, Editor, MarkdownView, Notice, Plugin, TFile, TFolder, Vault } from 'obsidian';
import { RAGFlowSettings, DEFAULT_SETTINGS, RAGFlowSettingTab } from './settings';
import { RAGFlowApi, Message } from './ragflow-api';
import { ConversationModal } from './conversation-modal';

export default class RAGFlowPlugin extends Plugin {
	settings: RAGFlowSettings;
	ragflowApi: RAGFlowApi;

	async onload() {
		await this.loadSettings();
		this.ragflowApi = new RAGFlowApi(this.settings);

		// Add ribbon icon for starting a conversation
		const ribbonIconEl = this.addRibbonIcon('message-square', 'RAGFlow Conversation', (evt: MouseEvent) => {
			this.startConversation();
		});
		ribbonIconEl.addClass('ragflow-ribbon-icon');

		// Add command for starting a conversation
		this.addCommand({
			id: 'start-ragflow-conversation',
			name: 'Start RAGFlow Conversation',
			callback: () => {
				this.startConversation();
			}
		});

		// Add settings tab
		this.addSettingTab(new RAGFlowSettingTab(this.app, this));
	}

	onunload() {
		// Clean up resources if needed
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Update the API client with new settings
		this.ragflowApi = new RAGFlowApi(this.settings);
	}

	/**
	 * Start a new conversation with RAGFlow
	 */
	async startConversation() {
		try {
			console.log('Starting RAGFlow conversation with settings:', {
				url: this.settings.ragflowUrl,
				hasApiKey: !!this.settings.apiKey,
				chatAssistantId: this.settings.chatAssistantId
			});

			// Check if settings are configured
			if (!this.settings.ragflowUrl) {
				new Notice('Please set your RAGFlow URL in the settings');
				return;
			}

			if (!this.settings.apiKey) {
				new Notice('Please set your RAGFlow API key in the settings');
				return;
			}

			if (!this.settings.chatAssistantId) {
				new Notice('Please select a chat assistant in the settings');
				return;
			}

			// Create a new instance of the API client to ensure it has the latest settings
			this.ragflowApi = new RAGFlowApi(this.settings);

			// Open the conversation modal in a try-catch block
			try {
				const modal = new ConversationModal(this.app, this);
				modal.open();
			} catch (modalError) {
				console.error('Error opening conversation modal:', modalError);
				new Notice(`Error opening conversation: ${modalError.message}`);
			}
		} catch (error) {
			console.error('Error starting conversation:', error);
			new Notice(`Error starting conversation: ${error.message}`);
		}
	}

	/**
	 * Save conversation to a note in Obsidian
	 */
	async saveConversationToNote(messages: Message[]) {
		if (messages.length === 0) return;

		// Create folder if it doesn't exist
		await this.ensureFolderExists(this.settings.saveFolderPath);

		// Generate a filename based on the first user message
		const firstUserMessage = messages.find(m => m.role === 'user');
		const title = firstUserMessage
			? firstUserMessage.content.substring(0, 50).replace(/[\\/:*?"<>|]/g, '_')
			: `RAGFlow Conversation ${new Date().toLocaleString()}`;

		// Create the file path
		const filePath = `${this.settings.saveFolderPath}/${title}.md`;

		// Format the conversation as markdown
		const content = this.formatConversationAsMarkdown(messages);

		// Check if the file already exists
		const existingFile = this.app.vault.getAbstractFileByPath(filePath);

		if (existingFile instanceof TFile) {
			// File exists, append to it
			const existingContent = await this.app.vault.read(existingFile);
			await this.app.vault.modify(existingFile, existingContent + '\n\n' + content);
			new Notice(`Conversation appended to ${filePath}`);
		} else {
			// Create a new file
			await this.app.vault.create(filePath, content);
			new Notice(`Conversation saved to ${filePath}`);
		}
	}

	/**
	 * Format conversation as markdown
	 */
	private formatConversationAsMarkdown(messages: Message[]): string {
		let markdown = `# RAGFlow Conversation\n\n`;
		markdown += `*Chat Assistant: ${this.settings.chatAssistantName || this.settings.chatAssistantId}*\n\n`;
		markdown += `*Date: ${new Date().toLocaleString()}*\n\n`;
		markdown += `---\n\n`;

		messages.forEach(message => {
			// Skip temporary messages
			if (message.isTemporary) return;

			const role = message.role === 'user' ? '**You**' : '**RAGFlow**';

			// Clean up the content
			let content = message.content;

			// Remove <think> tags and their content
			content = content.replace(/<think>[\s\S]*?<\/think>/g, '');

			// Remove any remaining HTML tags
			content = content.replace(/<[^>]*>/g, '');

			// Remove reference markers like ##0$$ ##2$$
			content = content.replace(/##\d+\$\$/g, '');

			// Remove any remaining reference markers with different formats
			content = content.replace(/\[\d+\]/g, ''); // Remove [1], [2], etc.
			content = content.replace(/\(ref:\s*\d+\)/gi, ''); // Remove (ref: 1), (Ref: 2), etc.
			content = content.replace(/\{\s*ref\s*:\s*\d+\s*\}/gi, ''); // Remove {ref: 1}, {Ref: 2}, etc.
			content = content.replace(/##\d+/g, ''); // Remove ##1, ##2, etc. without $$
			content = content.replace(/\$\$/g, ''); // Remove any remaining $$ symbols

			// Trim whitespace and normalize spaces
			content = content.trim();

			// Fix any broken sentences due to removed references
			content = content.replace(/\s+([.,;:!?])/g, '$1'); // Remove spaces before punctuation

			// Replace multiple spaces with a single space, but preserve line breaks
			content = content.split('\n').map(line => {
				// Clean up each line individually
				return line.replace(/\s{2,}/g, ' ').trim();
			}).join('\n');

			// Remove empty lines (more than one consecutive newline)
			content = content.replace(/\n{3,}/g, '\n\n');

			// Skip empty messages
			if (!content) return;

			markdown += `### ${role}\n\n${content}\n\n`;

			// Add references if available
			if (message.reference && message.reference.length > 0) {
				markdown += `**References:**\n\n`;
				message.reference.forEach(ref => {
					// Clean up reference content
					let refContent = ref.content || '';
					refContent = refContent.replace(/<[^>]*>/g, '').trim();

					markdown += `- **${ref.document_name || 'Unknown document'}**: ${refContent.substring(0, 200)}${refContent.length > 200 ? '...' : ''}\n`;
				});
				markdown += `\n`;
			}
		});

		return markdown;
	}

	/**
	 * Ensure a folder exists, creating it if necessary
	 */
	private async ensureFolderExists(folderPath: string) {
		const folders = folderPath.split('/').filter(p => p.length > 0);
		let currentPath = '';

		for (const folder of folders) {
			currentPath = currentPath ? `${currentPath}/${folder}` : folder;
			const existingFolder = this.app.vault.getAbstractFileByPath(currentPath);

			if (!existingFolder) {
				await this.app.vault.createFolder(currentPath);
			} else if (!(existingFolder instanceof TFolder)) {
				throw new Error(`${currentPath} exists but is not a folder`);
			}
		}
	}
}
