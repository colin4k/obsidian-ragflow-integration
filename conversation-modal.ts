import { App, Modal, Setting, Notice, ButtonComponent, TextAreaComponent, MarkdownRenderer } from 'obsidian';
import { RAGFlowApi, Message, ChatSession, ChatAssistant } from './ragflow-api';
import RAGFlowPlugin from './main';

export class ConversationModal extends Modal {
    private plugin: RAGFlowPlugin;
    private ragflowApi: RAGFlowApi;
    private chatAssistant: ChatAssistant | null = null;
    private chatSession: ChatSession | null = null;
    private messages: Message[] = [];
    private inputEl: TextAreaComponent;
    private messagesEl: HTMLElement;
    private saveButtonEl: ButtonComponent;
    private loadingEl: HTMLElement;
    private statusEl: HTMLElement;
    private assistantSelectorEl: HTMLSelectElement;
    private chatAssistants: ChatAssistant[] = [];
    private isSaving = false;
    private isTestMode = false;

    constructor(app: App, plugin: RAGFlowPlugin) {
        super(app);
        console.log('Initializing ConversationModal');
        this.plugin = plugin;

        try {
            // Make sure we have a valid API client
            if (!plugin.ragflowApi) {
                console.error('RAGFlow API client is not initialized');
                throw new Error('RAGFlow API client is not initialized');
            }

            this.ragflowApi = plugin.ragflowApi;
            console.log('RAGFlow API client initialized successfully');
        } catch (error) {
            console.error('Error in ConversationModal constructor:', error);
            throw error;
        }
    }

    async onOpen() {
        try {
            console.log('Opening RAGFlow conversation modal');
            const { contentEl } = this;
            contentEl.empty();
            contentEl.addClass('ragflow-conversation-modal');

            // Create header
            const headerEl = contentEl.createEl('div', { cls: 'ragflow-modal-header' });
            headerEl.createEl('h2', { text: 'RAGFlow Conversation' });

            // Create assistant selector container
            const assistantSelectorContainer = contentEl.createEl('div', { cls: 'ragflow-assistant-selector-container' });

            // Create label
            assistantSelectorContainer.createEl('span', { text: 'Chat Assistant: ', cls: 'ragflow-assistant-selector-label' });

            // Create assistant selector
            this.assistantSelectorEl = assistantSelectorContainer.createEl('select', { cls: 'ragflow-assistant-selector' });

            // Add placeholder option
            const placeholderOption = this.assistantSelectorEl.createEl('option');
            placeholderOption.value = '';
            placeholderOption.text = 'Loading assistants...';
            placeholderOption.disabled = true;
            placeholderOption.selected = true;

            // Add event listener to handle assistant selection
            this.assistantSelectorEl.addEventListener('change', async () => {
                const selectedAssistantId = this.assistantSelectorEl.value;
                if (selectedAssistantId) {
                    await this.changeAssistant(selectedAssistantId);
                }
            });

            // Create status message area
            this.statusEl = contentEl.createEl('div', { cls: 'ragflow-status-message' });
            this.statusEl.setText('Initializing conversation...');

            // Create loading indicator
            this.loadingEl = contentEl.createEl('div', { cls: 'ragflow-loading-indicator' });
            this.loadingEl.createEl('div', { cls: 'ragflow-spinner' });
            this.loadingEl.createEl('div', { text: 'Loading...', cls: 'ragflow-loading-text' });
            this.loadingEl.style.display = 'none';

            // Create messages container
            this.messagesEl = contentEl.createEl('div', { cls: 'ragflow-messages-container' });

            // Create input area
            const inputContainerEl = contentEl.createEl('div', { cls: 'ragflow-input-container' });

            // Create textarea for user input
            this.inputEl = new TextAreaComponent(inputContainerEl)
                .setPlaceholder('Type your question here...')
                .onChange(() => {
                    // Adjust height based on content
                    const textarea = this.inputEl.inputEl;
                    textarea.style.height = 'auto';
                    textarea.style.height = `${textarea.scrollHeight}px`;
                });

            this.inputEl.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });

            // Create button container
            const buttonContainerEl = contentEl.createEl('div', { cls: 'ragflow-button-container' });

            // Create send button
            new ButtonComponent(buttonContainerEl)
                .setButtonText('Send')
                .setCta()
                .onClick(() => this.sendMessage());

            // Create close button
            new ButtonComponent(buttonContainerEl)
                .setButtonText('Close')
                .onClick(() => this.close());

            // Create save button (only shown when auto-save is disabled)
            this.saveButtonEl = new ButtonComponent(buttonContainerEl)
                .setButtonText('Save Conversation')
                .onClick(() => this.saveConversation());

            // Show/hide save button based on auto-save setting
            this.saveButtonEl.buttonEl.style.display = this.plugin.settings.autoSave ? 'none' : 'inline-block';

            // Disable input until initialization is complete
            this.inputEl.setDisabled(true);

            // Initialize the conversation
            this.showLoading(true);

            try {
                console.log('RAGFlow settings:', {
                    url: this.plugin.settings.ragflowUrl,
                    hasApiKey: !!this.plugin.settings.apiKey,
                    chatAssistantId: this.plugin.settings.chatAssistantId,
                    chatAssistantName: this.plugin.settings.chatAssistantName
                });

                // Always enter test mode first to ensure the UI is usable
                this.enterTestMode('Initializing...');

                // Try to initialize the real conversation
                await this.initializeConversation();

                // If we get here, initialization was successful
                this.statusEl.remove();
                this.showLoading(false);
                this.inputEl.setDisabled(false);
            } catch (error) {
                console.error('Conversation initialization failed:', error);
                this.showLoading(false);

                // Make sure we're in test mode so the UI is still usable
                if (!this.isTestMode) {
                    this.enterTestMode(error.message);
                }

                // Update status message
                this.statusEl.setText(`Error: ${error.message}`);
                this.statusEl.addClass('ragflow-error-message');

                // Show notice but don't close the modal
                new Notice(`Failed to initialize conversation: ${error.message}`);

                // Enable input for test mode
                this.inputEl.setDisabled(false);
            }
        } catch (error) {
            console.error('Fatal error in onOpen:', error);
            new Notice(`Fatal error: ${error.message}`);
            this.close();
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    /**
     * Enter test mode with mock objects for a usable UI even when RAGFlow is unavailable
     */
    private enterTestMode(errorMessage: string) {
        console.log('Entering test mode with error:', errorMessage);
        this.isTestMode = true;

        // Create mock chat assistant if it doesn't exist
        if (!this.chatAssistant) {
            this.chatAssistant = {
                id: 'mock-assistant-id',
                name: 'Mock Assistant'
            };
        }

        // Create mock chat session if it doesn't exist
        if (!this.chatSession) {
            this.chatSession = {
                id: 'mock-session-id',
                name: 'Mock Session',
                messages: []
            };
        }

        // Add warning message if we don't have any messages yet
        if (this.messages.length === 0) {
            // Add warning message
            this.addMessage({
                role: 'assistant',
                content: '⚠️ **Warning**: Could not connect to RAGFlow API. ' +
                         'This is running in test mode and will not use your knowledge base. ' +
                         'Please check your settings and try again.\n\n' +
                         'Error: ' + errorMessage
            });

            // Add mock welcome message
            this.addMessage({
                role: 'assistant',
                content: 'This is a mock conversation for testing. Your messages will not be sent to RAGFlow.'
            });
        }
    }

    /**
     * Initialize the conversation with RAGFlow
     */
    private async initializeConversation() {
        try {
            // Validate settings
            if (!this.plugin.settings.ragflowUrl) {
                throw new Error('RAGFlow URL is not set. Please set it in the settings.');
            }

            if (!this.plugin.settings.apiKey) {
                throw new Error('RAGFlow API key is not set. Please set it in the settings.');
            }

            if (!this.plugin.settings.chatAssistantId) {
                throw new Error('No chat assistant selected. Please select a chat assistant in the settings.');
            }

            console.log('Initializing conversation with chat assistant:', this.plugin.settings.chatAssistantId);

            // Test the connection first
            console.log('Testing connection to RAGFlow API...');
            const connectionSuccess = await this.ragflowApi.testConnection();
            if (!connectionSuccess) {
                throw new Error('Could not connect to RAGFlow API. Please check your settings.');
            }
            console.log('Connection test successful');

            // Verify that the selected chat assistant exists
            console.log('Verifying chat assistant exists...');
            try {
                // Get the list of chat assistants
                const chatAssistants = await this.ragflowApi.listChatAssistants();

                // Find the selected chat assistant in the list
                const assistantExists = chatAssistants.some(assistant =>
                    assistant.id === this.plugin.settings.chatAssistantId
                );

                if (!assistantExists) {
                    throw new Error('Selected chat assistant does not exist on the server. Please select a different assistant.');
                }

                // Use the selected chat assistant
                console.log('Using existing chat assistant...');
                this.chatAssistant = {
                    id: this.plugin.settings.chatAssistantId,
                    name: this.plugin.settings.chatAssistantName || 'RAGFlow Assistant'
                };

                console.log('Using chat assistant:', this.chatAssistant);

                // We'll create a session when we send the first message
                console.log('Chat assistant initialized, session will be created when sending the first message');

                // Initialize an empty session object
                this.chatSession = {
                    id: '',
                    name: '',
                    messages: []
                };
            } catch (assistantError) {
                console.error('Error verifying chat assistant or creating session:', assistantError);
                throw new Error(`Could not initialize conversation: ${assistantError.message}`);
            }



            // We've successfully initialized, so we're not in test mode
            this.isTestMode = false;

            // Clear any existing messages (from test mode)
            this.messages = [];
            this.messagesEl.empty();

            // Load the list of chat assistants
            await this.loadChatAssistants();

            // Add welcome message
            this.addMessage({
                role: 'assistant',
                content: `Hi! I am your RAGFlow assistant using **${this.chatAssistant?.name || 'default assistant'}**. How can I help you with your knowledge base today?`
            });

            return true;
        } catch (error) {
            console.error('Error initializing conversation:', error);
            throw error;
        }
    }



    /**
     * Send a message to RAGFlow and get a response
     */
    private async sendMessage() {
        try {
            const message = this.inputEl.getValue().trim();
            if (!message) return;

            // Validate that we have the required objects
            if (!this.chatAssistant || !this.chatSession) {
                console.error('Chat assistant or session is not initialized');
                new Notice('Conversation is not properly initialized. Please try again.');
                return;
            }

            // Clear input and disable it while processing
            this.inputEl.setValue('');
            this.inputEl.setDisabled(true);

            // Add user message to the conversation
            this.addMessage({
                role: 'user',
                content: message
            });

            // Show loading indicator
            this.showLoading(true);

            try {
                // Check if we're in test mode
                if (this.isTestMode) {
                    console.log('Sending message in test mode');

                    // Simulate a delay
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // Create a mock response
                    const mockResponse: Message = {
                        role: 'assistant',
                        content: 'This is a mock response. The plugin is in test mode because it could not connect to RAGFlow. ' +
                                'Please check your settings and try again.'
                    };

                    // Add mock response to the conversation
                    this.addMessage(mockResponse);
                } else {
                    console.log(`Sending message to RAGFlow: "${message}"`);

                    try {
                        // Use the completions endpoint to send a message
                        console.log(`Sending completion message to assistant ${this.chatAssistant.id}`);

                        // Add a waiting message
                        const waitingMessageId = this.addMessage({
                            role: 'assistant',
                            content: '正在思考中...',
                            isTemporary: true
                        });

                        // Log the message we're about to send
                        console.log(`Sending user question: "${message}"`);
                        console.log(`Current chat assistant:`, this.chatAssistant);

                        // Send the message to the chat assistant using the OpenAI-compatible endpoint
                        console.log(`Using OpenAI-compatible endpoint for chat assistant ${this.chatAssistant.id}`);

                        // Create a response message that will be updated as we receive chunks
                        const responseMessageId = this.addMessage({
                            role: 'assistant',
                            content: '',
                            reference: []
                        });

                        // Get the streaming response
                        const response = await this.ragflowApi.sendOpenAICompatibleMessage(
                            this.chatAssistant.id,
                            message
                        );

                        // We don't get a session ID from the OpenAI-compatible endpoint
                        const sessionId = this.chatSession?.id || '';

                        // Process the streaming response
                        if (response.processStream) {
                            let fullAnswer = '';

                            await response.processStream((chunk, done) => {
                                if (!done) {
                                    // Update the message with the new chunk
                                    fullAnswer += chunk;
                                    this.updateMessageContent(responseMessageId, fullAnswer);
                                }
                            });
                        } else {
                            // If it's not a streaming response, just use the answer
                            this.updateMessageContent(responseMessageId, response.answer);
                        }

                        // Use empty references since we don't get them from the OpenAI-compatible endpoint
                        const reference = response.reference || [];

                        // Remove the waiting message
                        this.removeMessage(waitingMessageId);

                        console.log('Received completion response:', { sessionId, hasReference: !!reference });

                        // Update the session ID if we got one back
                        if (sessionId) {
                            this.chatSession = {
                                id: sessionId,
                                name: `Obsidian Session ${new Date().toLocaleString()}`,
                                messages: []
                            };
                            console.log('Updated chat session:', this.chatSession);
                        }

                        // We've already added the assistant response in the streaming code above

                    } catch (sendError) {
                        console.error('Error sending completion message:', sendError);
                        throw sendError;
                    }
                }

                // Auto-save if enabled, but wait a moment to ensure we have the complete response
                if (this.plugin.settings.autoSave) {
                    // Add a small delay before saving to ensure we have the complete response
                    setTimeout(async () => {
                        try {
                            await this.saveConversation();
                            console.log('Conversation saved after delay');
                        } catch (saveError) {
                            console.error('Error saving conversation after delay:', saveError);
                        }
                    }, 1000); // 1 second delay
                }
            } catch (error) {
                console.error('Error sending message:', error);

                // Enter test mode if we weren't already in it
                if (!this.isTestMode) {
                    this.enterTestMode(error.message);
                }

                // Add error message to the conversation
                this.addMessage({
                    role: 'assistant',
                    content: `⚠️ **Error**: Failed to send message: ${error.message}. Please check your connection and settings.`
                });

                new Notice(`Failed to send message: ${error.message}`);
            } finally {
                this.showLoading(false);
                this.inputEl.setDisabled(false);
            }
        } catch (error) {
            console.error('Fatal error in sendMessage:', error);
            new Notice(`Error: ${error.message}`);
            this.inputEl.setDisabled(false);
            this.showLoading(false);
        }
    }

    /**
     * Add a message to the conversation UI
     * @returns The ID of the added message
     */
    private addMessage(message: Message): string {
        try {
            // Generate a unique ID for the message if not provided
            if (!message.id) {
                message.id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            }

            // Add to messages array
            this.messages.push(message);

            // Create message element
            const messageEl = this.messagesEl.createEl('div', {
                cls: `ragflow-message ragflow-message-${message.role}${message.isTemporary ? ' ragflow-message-temporary' : ''}`
            });

            // Set the message ID as a data attribute for later reference
            messageEl.dataset.messageId = message.id;

            // Create content element
            const contentEl = messageEl.createEl('div', {
                cls: 'ragflow-message-content'
            });

            // Set content as text (we'll use basic HTML for formatting)
            contentEl.innerHTML = message.content
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
                .replace(/\*(.*?)\*/g, '<em>$1</em>') // Italic
                .replace(/\n/g, '<br>'); // Line breaks

            // Add references if available
            if (message.reference && message.reference.length > 0) {
                const referencesEl = messageEl.createEl('div', {
                    cls: 'ragflow-message-references'
                });

                referencesEl.createEl('h4', {
                    text: 'References:'
                });

                const referencesList = referencesEl.createEl('ul');

                message.reference.forEach(ref => {
                    try {
                        const refItem = referencesList.createEl('li');
                        refItem.createEl('strong', {
                            text: ref.document_name || 'Unknown document'
                        });
                        refItem.createSpan({
                            text: `: ${ref.content ? ref.content.substring(0, 100) + (ref.content.length > 100 ? '...' : '') : 'No content'}`
                        });
                    } catch (refError) {
                        console.error('Error rendering reference:', refError, ref);
                    }
                });
            }

            // Scroll to bottom
            setTimeout(() => {
                this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
            }, 10);

            return message.id;
        } catch (error) {
            console.error('Error adding message to UI:', error, message);
            return '';
        }
    }

    /**
     * Remove a message from the conversation UI
     */
    private removeMessage(messageId: string): boolean {
        try {
            if (!messageId) return false;

            // Find the message in the array
            const messageIndex = this.messages.findIndex(msg => msg.id === messageId);
            if (messageIndex >= 0) {
                // Remove from the array
                this.messages.splice(messageIndex, 1);
            }

            // Find and remove the message element
            const messageEl = this.messagesEl.querySelector(`[data-message-id="${messageId}"]`);
            if (messageEl) {
                messageEl.remove();
                return true;
            }

            return false;
        } catch (error) {
            console.error('Error removing message from UI:', error, messageId);
            return false;
        }
    }

    private async saveConversation() {
        if (this.isSaving || this.messages.length === 0) return;

        this.isSaving = true;
        this.saveButtonEl.setButtonText('Saving...');
        this.saveButtonEl.setDisabled(true);

        try {
            await this.plugin.saveConversationToNote(this.messages);
            new Notice('Conversation saved successfully');
        } catch (error) {
            new Notice(`Failed to save conversation: ${error.message}`);
        } finally {
            this.isSaving = false;
            this.saveButtonEl.setButtonText('Save Conversation');
            this.saveButtonEl.setDisabled(false);
        }
    }

    private showLoading(show: boolean) {
        this.loadingEl.style.display = show ? 'flex' : 'none';
    }

    /**
     * Load the list of chat assistants from RAGFlow
     */
    private async loadChatAssistants() {
        try {
            // Clear existing options except the placeholder
            while (this.assistantSelectorEl.options.length > 1) {
                this.assistantSelectorEl.remove(1);
            }

            // Get the list of chat assistants
            this.chatAssistants = await this.ragflowApi.listChatAssistants();

            if (this.chatAssistants.length === 0) {
                // Update placeholder if no assistants found
                this.assistantSelectorEl.options[0].text = 'No chat assistants found';
                return;
            }

            // Update placeholder
            this.assistantSelectorEl.options[0].text = 'Select a chat assistant...';

            // Add options for each chat assistant
            this.chatAssistants.forEach(assistant => {
                const option = this.assistantSelectorEl.createEl('option');
                option.value = assistant.id;
                option.text = assistant.name;

                // Select the current assistant if it matches
                if (this.chatAssistant && assistant.id === this.chatAssistant.id) {
                    option.selected = true;
                }
            });

            // If we have a current assistant but it's not in the list, add it
            if (this.chatAssistant && !this.chatAssistants.some(a => a.id === this.chatAssistant?.id)) {
                const option = this.assistantSelectorEl.createEl('option');
                option.value = this.chatAssistant.id;
                option.text = this.chatAssistant.name;
                option.selected = true;
            }
        } catch (error) {
            console.error('Error loading chat assistants:', error);
            this.assistantSelectorEl.options[0].text = 'Error loading assistants';
        }
    }

    /**
     * Change the current chat assistant
     */
    private async changeAssistant(assistantId: string) {
        try {
            // Find the assistant in our list
            const assistant = this.chatAssistants.find(a => a.id === assistantId);

            if (!assistant) {
                throw new Error(`Chat assistant with ID ${assistantId} not found`);
            }

            // Show loading indicator
            this.showLoading(true);

            // Update the current assistant
            this.chatAssistant = assistant;

            // Update the plugin settings
            this.plugin.settings.chatAssistantId = assistant.id;
            this.plugin.settings.chatAssistantName = assistant.name;
            await this.plugin.saveSettings();

            // Clear the current session and messages
            this.chatSession = {
                id: '',
                name: '',
                messages: []
            };

            this.messages = [];
            this.messagesEl.empty();

            // Add welcome message
            this.addMessage({
                role: 'assistant',
                content: `Hi! I am your RAGFlow assistant using **${assistant.name}**. How can I help you with your knowledge base today?`
            });

            // Hide loading indicator
            this.showLoading(false);

            new Notice(`Switched to chat assistant: ${assistant.name}`);
        } catch (error) {
            console.error('Error changing chat assistant:', error);
            new Notice(`Failed to change chat assistant: ${error.message}`);
            this.showLoading(false);
        }
    }

    /**
     * Update the content of an existing message
     */
    private updateMessageContent(messageId: string, content: string): boolean {
        try {
            if (!messageId) return false;

            // Find the message in the array
            const messageIndex = this.messages.findIndex(msg => msg.id === messageId);
            if (messageIndex >= 0) {
                // Update the content in the array
                this.messages[messageIndex].content = content;
            }

            // Find and update the message element
            const messageEl = this.messagesEl.querySelector(`[data-message-id="${messageId}"]`);
            if (messageEl) {
                const contentEl = messageEl.querySelector('.ragflow-message-content');
                if (contentEl) {
                    // Update the HTML content with formatting
                    contentEl.innerHTML = content
                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
                        .replace(/\*(.*?)\*/g, '<em>$1</em>') // Italic
                        .replace(/\n/g, '<br>'); // Line breaks

                    // Scroll to bottom
                    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;

                    return true;
                }
            }

            return false;
        } catch (error) {
            console.error('Error updating message content:', error, messageId);
            return false;
        }
    }
}
