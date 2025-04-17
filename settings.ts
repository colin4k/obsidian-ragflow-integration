import { App, PluginSettingTab, Setting, Notice, ButtonComponent } from 'obsidian';
import RAGFlowPlugin from './main';

export interface RAGFlowSettings {
    ragflowUrl: string;
    apiKey: string;
    chatAssistantId: string;
    chatAssistantName: string;
    saveFolderPath: string;
    autoSave: boolean;
}

export const DEFAULT_SETTINGS: RAGFlowSettings = {
    ragflowUrl: 'http://localhost:9380',
    apiKey: '',
    chatAssistantId: '',
    chatAssistantName: '',
    saveFolderPath: 'RAGFlow Conversations',
    autoSave: true
};

export class RAGFlowSettingTab extends PluginSettingTab {
    plugin: RAGFlowPlugin;
    private connectionStatusEl: HTMLElement;

    constructor(app: App, plugin: RAGFlowPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'RAGFlow Integration Settings' });

        // Connection status indicator
        this.connectionStatusEl = containerEl.createEl('div', {
            cls: 'ragflow-connection-status',
            text: 'Connection status: Not tested'
        });

        // RAGFlow URL setting
        new Setting(containerEl)
            .setName('RAGFlow URL')
            .setDesc('The URL of your RAGFlow instance (e.g., http://localhost:9380)')
            .addText(text => text
                .setPlaceholder('http://localhost:9380')
                .setValue(this.plugin.settings.ragflowUrl)
                .onChange(async (value) => {
                    this.plugin.settings.ragflowUrl = value;
                    await this.plugin.saveSettings();
                    this.updateConnectionStatus('Not tested');
                }));

        // RAGFlow API Key setting
        new Setting(containerEl)
            .setName('RAGFlow API Key')
            .setDesc('Your RAGFlow API key for authentication')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                    this.updateConnectionStatus('Not tested');

                    // Auto-refresh chat assistants if API key is not empty
                    if (value) {
                        await this.testAndRefreshChatAssistants();
                    }
                }));

        // Test connection button
        new Setting(containerEl)
            .setName('Test Connection')
            .setDesc('Test the connection to your RAGFlow instance')
            .addButton(button => button
                .setButtonText('Test Connection')
                .onClick(async () => {
                    await this.testConnection(button);
                }));

        // Chat Assistant dropdown
        const assistantSetting = new Setting(containerEl)
            .setName('Chat Assistant')
            .setDesc('Select an existing RAGFlow chat assistant')
            .addDropdown(dropdown => {
                dropdown.addOption('', 'Select a chat assistant');
                // This will be populated when the API is connected
                if (this.plugin.settings.chatAssistantId) {
                    dropdown.addOption(
                        this.plugin.settings.chatAssistantId,
                        this.plugin.settings.chatAssistantName || this.plugin.settings.chatAssistantId
                    );
                }
                dropdown.setValue(this.plugin.settings.chatAssistantId);
                dropdown.onChange(async (value) => {
                    if (!value) {
                        // If no value is selected, clear the assistant ID and name
                        this.plugin.settings.chatAssistantId = '';
                        this.plugin.settings.chatAssistantName = '';
                    } else {
                        // Update the assistant ID
                        this.plugin.settings.chatAssistantId = value;

                        // Find the name of the selected chat assistant
                        const selectedOption = dropdown.selectEl.options[dropdown.selectEl.selectedIndex];
                        if (selectedOption) {
                            this.plugin.settings.chatAssistantName = selectedOption.textContent || '';
                            console.log('Selected chat assistant:', {
                                id: value,
                                name: this.plugin.settings.chatAssistantName
                            });
                        }
                    }

                    // Save the settings
                    await this.plugin.saveSettings();
                });
            });

        // Add a note about auto-refresh
        const infoEl = containerEl.createEl('div', {
            cls: 'ragflow-info-message',
            text: 'Note: Chat assistants are automatically refreshed when you set the API key or test the connection.'
        });

        // Save folder path setting
        new Setting(containerEl)
            .setName('Save Folder Path')
            .setDesc('Folder path where conversation notes will be saved')
            .addText(text => text
                .setPlaceholder('RAGFlow Conversations')
                .setValue(this.plugin.settings.saveFolderPath)
                .onChange(async (value) => {
                    this.plugin.settings.saveFolderPath = value;
                    await this.plugin.saveSettings();
                }));

        // Auto-save toggle
        new Setting(containerEl)
            .setName('Auto-save Conversations')
            .setDesc('Automatically save conversations after each Q&A exchange')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSave)
                .onChange(async (value) => {
                    this.plugin.settings.autoSave = value;
                    await this.plugin.saveSettings();
                }));

        // Add troubleshooting section
        containerEl.createEl('h3', { text: 'Troubleshooting' });

        const troubleshootingEl = containerEl.createEl('div', { cls: 'ragflow-troubleshooting' });

        troubleshootingEl.createEl('p', {
            text: 'If you are experiencing issues with the RAGFlow integration, try the following:'
        });

        const tipsList = troubleshootingEl.createEl('ul');

        tipsList.createEl('li', {
            text: 'Make sure your RAGFlow server is running and accessible from this device.'
        });

        tipsList.createEl('li', {
            text: 'Check that the URL is correct and includes the protocol (http:// or https://).'
        });

        tipsList.createEl('li', {
            text: 'Verify that your API key is correct and has the necessary permissions.'
        });

        tipsList.createEl('li', {
            text: 'Try refreshing the knowledge bases after confirming the connection is working.'
        });

        tipsList.createEl('li', {
            text: 'Check the developer console for detailed error messages (Ctrl+Shift+I or Cmd+Option+I).'
        });
    }

    /**
     * Update the connection status indicator
     */
    private updateConnectionStatus(status: string, isSuccess: boolean = false) {
        this.connectionStatusEl.setText(`Connection status: ${status}`);
        this.connectionStatusEl.removeClass('ragflow-connection-success', 'ragflow-connection-error');

        if (status !== 'Not tested') {
            this.connectionStatusEl.addClass(
                isSuccess ? 'ragflow-connection-success' : 'ragflow-connection-error'
            );
        }
    }

    /**
     * Test the connection to the RAGFlow API
     */
    private async testConnection(button: ButtonComponent) {
        button.setButtonText('Testing...');
        button.setDisabled(true);

        try {
            // Validate settings
            if (!this.plugin.settings.ragflowUrl) {
                throw new Error('RAGFlow URL is not set');
            }

            if (!this.plugin.settings.apiKey) {
                throw new Error('RAGFlow API key is not set');
            }

            // Update the API client with current settings
            await this.plugin.saveSettings();

            // Test the connection
            const success = await this.plugin.ragflowApi.testConnection();

            if (success) {
                this.updateConnectionStatus('Connected', true);
                new Notice('Successfully connected to RAGFlow');

                // Auto-refresh chat assistants after successful connection
                try {
                    // Find the assistant setting and refresh button
                    const assistantSetting = Array.from(this.containerEl.querySelectorAll('.setting-item')).find(
                        item => item.querySelector('.setting-item-name')?.textContent === 'Chat Assistant'
                    );

                    if (assistantSetting) {
                        const dropdown = assistantSetting.querySelector('select') as HTMLSelectElement;
                        if (dropdown) {
                            new Notice('Refreshing chat assistants...');
                            await this.refreshChatAssistantsWithUI(dropdown);
                        }
                    }
                } catch (refreshError) {
                    console.error('Error auto-refreshing chat assistants:', refreshError);
                    // Don't throw the error, just log it
                }
            } else {
                this.updateConnectionStatus('Failed to connect', false);
                new Notice('Failed to connect to RAGFlow');
            }
        } catch (error) {
            console.error('Connection test error:', error);
            this.updateConnectionStatus(`Error: ${error.message}`, false);
            new Notice(`Connection error: ${error.message}`);
        } finally {
            button.setButtonText('Test Connection');
            button.setDisabled(false);
        }
    }

    /**
     * Test connection and refresh chat assistants if successful
     */
    private async testAndRefreshChatAssistants() {
        try {
            // Validate settings
            if (!this.plugin.settings.ragflowUrl || !this.plugin.settings.apiKey) {
                return;
            }

            // Update the API client with current settings
            await this.plugin.saveSettings();

            // Test the connection silently
            const success = await this.plugin.ragflowApi.testConnection();

            if (success) {
                // Find the assistant setting and refresh button
                const assistantSetting = Array.from(this.containerEl.querySelectorAll('.setting-item')).find(
                    item => item.querySelector('.setting-item-name')?.textContent === 'Chat Assistant'
                );

                if (assistantSetting) {
                    const refreshButton = Array.from(this.containerEl.querySelectorAll('.setting-item')).find(
                        item => item.querySelector('.setting-item-name')?.textContent === 'Refresh Chat Assistants'
                    )?.querySelector('button');

                    if (refreshButton) {
                        // Simulate a click on the refresh button
                        const dropdown = assistantSetting.querySelector('select') as HTMLSelectElement;
                        if (dropdown) {
                            await this.refreshChatAssistantsWithUI(dropdown);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Auto-refresh error:', error);
            // Silent error - don't bother the user
        }
    }



    /**
     * Refresh the chat assistants in the UI
     */
    private async refreshChatAssistantsWithUI(selectEl: HTMLSelectElement) {
        try {
            // Clear existing options except the placeholder
            selectEl.innerHTML = '';
            const placeholderOption = document.createElement('option');
            placeholderOption.value = '';
            placeholderOption.text = 'Select a chat assistant';
            selectEl.add(placeholderOption);

            // Load chat assistants from RAGFlow API
            const chatAssistants = await this.plugin.ragflowApi.listChatAssistants();

            if (chatAssistants.length === 0) {
                new Notice('No chat assistants found');
            } else {
                // Add options for each chat assistant
                chatAssistants.forEach(assistant => {
                    const option = document.createElement('option');
                    option.value = assistant.id;
                    option.text = assistant.name;
                    option.dataset.name = assistant.name; // Store name in dataset for later retrieval
                    selectEl.add(option);
                });

                // Restore the selected value if it exists
                if (this.plugin.settings.chatAssistantId) {
                    selectEl.value = this.plugin.settings.chatAssistantId;

                    // Update the assistant name in settings
                    const selectedOption = selectEl.querySelector(`option[value="${this.plugin.settings.chatAssistantId}"]`) as HTMLOptionElement;
                    if (selectedOption) {
                        this.plugin.settings.chatAssistantName = selectedOption.text;
                        this.plugin.saveSettings();
                    }
                }

                // Add change event listener to update the assistant name when selection changes
                selectEl.addEventListener('change', async (e) => {
                    const target = e.target as HTMLSelectElement;
                    const selectedOption = target.options[target.selectedIndex];
                    if (selectedOption && selectedOption.value) {
                        this.plugin.settings.chatAssistantId = selectedOption.value;
                        this.plugin.settings.chatAssistantName = selectedOption.text;
                        await this.plugin.saveSettings();
                        console.log('Updated chat assistant in settings:', {
                            id: this.plugin.settings.chatAssistantId,
                            name: this.plugin.settings.chatAssistantName
                        });
                    }
                });

                new Notice(`Loaded ${chatAssistants.length} chat assistants`);
            }

            return true;
        } catch (error) {
            console.error('Failed to load chat assistants:', error);
            throw error;
        }
    }
}
