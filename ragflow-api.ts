import { RAGFlowSettings } from './settings';
import { Notice } from 'obsidian';

export interface Dataset {
    id: string;
    name: string;
}

export interface ChatSession {
    id: string;
    name: string;
    messages: Message[];
}

export interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    reference?: Reference[];
    isTemporary?: boolean;
    id?: string;
}

export interface Reference {
    id: string;
    content: string;
    document_id: string;
    document_name: string;
    dataset_id: string;
}

export interface ChatAssistant {
    id: string;
    name: string;
}

export class RAGFlowApi {
    private settings: RAGFlowSettings;

    constructor(settings: RAGFlowSettings) {
        this.settings = settings;
    }

    /**
     * Make an authenticated request to the RAGFlow API
     */
    private async fetchWithAuth(endpoint: string, options: RequestInit = {}) {
        if (!this.settings.apiKey) {
            throw new Error('RAGFlow API key is not set');
        }

        if (!this.settings.ragflowUrl) {
            throw new Error('RAGFlow URL is not set');
        }

        // Ensure the URL has the correct format
        let baseUrl = this.settings.ragflowUrl;
        if (baseUrl.endsWith('/')) {
            baseUrl = baseUrl.slice(0, -1);
        }

        const url = `${baseUrl}${endpoint}`;

        // Prepare headers
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.settings.apiKey}`,
            ...options.headers
        };

        try {
            console.log(`RAGFlow API request to ${url}:`, {
                method: options.method || 'GET',
                headers: headers,
                body: options.body ? JSON.parse(options.body as string) : undefined
            });

            // Make the request
            const response = await fetch(url, {
                ...options,
                headers
            });

            // Handle non-OK responses
            if (!response.ok) {
                let errorMessage = `RAGFlow API error (${response.status})`;
                try {
                    const errorText = await response.text();
                    errorMessage += `: ${errorText}`;
                    console.error('RAGFlow API error response:', errorText);
                } catch (e) {
                    console.error('Failed to read error response:', e);
                }
                throw new Error(errorMessage);
            }

            // For streaming responses with OpenAI-compatible API, return the response directly
            if (endpoint.includes('/chats_openai/') && options.body) {
                const body = JSON.parse(options.body as string);
                if (body.stream === true) {
                    console.log('Returning raw response for streaming');
                    return response;
                }
            }

            // Parse the response
            const responseText = await response.text();
            console.log('RAGFlow API raw response text:', responseText);

            try {
                // Try to parse as JSON
                const data = JSON.parse(responseText);
                console.log('RAGFlow API parsed response:', data);
                return data;
            } catch (parseError) {
                // If it's not valid JSON, return it as is (might be streaming data)
                console.log('RAGFlow API response is not valid JSON, returning as is');
                return { code: 0, data: responseText };
            }
        } catch (error) {
            console.error('RAGFlow API error:', error);
            new Notice(`RAGFlow API error: ${error.message}`);
            throw error;
        }
    }

    /**
     * List all available datasets (knowledge bases)
     */
    async listDatasets(): Promise<Dataset[]> {
        try {
            const response = await this.fetchWithAuth('/api/v1/datasets');

            if (!response || !response.data || !Array.isArray(response.data)) {
                console.error('Invalid datasets response:', response);
                return [];
            }

            return response.data.map((dataset: any) => ({
                id: dataset.id || '',
                name: dataset.name || 'Unnamed Dataset'
            }));
        } catch (error) {
            console.error('Error listing datasets:', error);
            return [];
        }
    }

    /**
     * Create a chat assistant for a specific knowledge base using a direct API approach
     */
    async createChatAssistant(name: string, datasetId: string): Promise<ChatAssistant> {
        try {
            console.log(`Creating chat assistant with name: ${name}, datasetId: ${datasetId}`);

            // Validate inputs
            if (!datasetId) {
                throw new Error('Dataset ID is required');
            }

            // Generate a unique name with timestamp to avoid duplicates
            const uniqueName = `${name}_${Date.now()}`;

            // Make the API request
            const response = await this.fetchWithAuth('/api/v1/chats', {
                method: 'POST',
                body: JSON.stringify({
                    name: uniqueName,
                    dataset_ids: [datasetId]
                })
            });

            // Validate response
            if (!response) {
                throw new Error('Empty response from RAGFlow API');
            }

            // Check for error response format
            if (response.code && response.message) {
                throw new Error(`RAGFlow API error: ${response.message} (code: ${response.code})`);
            }

            if (!response.data) {
                throw new Error('Invalid response format: missing data field');
            }

            if (!response.data.id) {
                throw new Error('Invalid response: missing chat assistant ID');
            }

            // Create and return the chat assistant object
            const assistant: ChatAssistant = {
                id: response.data.id,
                name: response.data.name || uniqueName
            };

            console.log('Created chat assistant:', assistant);
            return assistant;
        } catch (error) {
            console.error('Failed to create chat assistant:', error);
            throw error;
        }
    }

    /**
     * Create a chat session with a chat assistant
     */
    async createChatSession(chatAssistantId: string, name: string = 'Obsidian Session'): Promise<ChatSession> {
        try {
            console.log(`Creating chat session for assistant ${chatAssistantId} with name: ${name}`);

            // Validate inputs
            if (!chatAssistantId) {
                throw new Error('Chat assistant ID is required');
            }

            // Generate a unique name with timestamp to avoid duplicates
            const uniqueName = `${name}_${Date.now()}`;

            // Make the API request
            const response = await this.fetchWithAuth(`/api/v1/chats/${chatAssistantId}/sessions`, {
                method: 'POST',
                body: JSON.stringify({
                    name: uniqueName
                })
            });

            // Validate response
            if (!response) {
                throw new Error('Empty response from RAGFlow API');
            }

            // Check for error response format
            if (response.code && response.message) {
                throw new Error(`RAGFlow API error: ${response.message} (code: ${response.code})`);
            }

            if (!response.data) {
                throw new Error('Invalid response format: missing data field');
            }

            if (!response.data.id) {
                throw new Error('Invalid response: missing session ID');
            }

            // Create and return the chat session object
            const session: ChatSession = {
                id: response.data.id,
                name: response.data.name || uniqueName,
                messages: response.data.messages || []
            };

            console.log('Created chat session:', session);
            return session;
        } catch (error) {
            console.error('Failed to create chat session:', error);
            throw error;
        }
    }

    /**
     * Send a message to a chat session and get the response
     */
    async sendMessage(chatAssistantId: string, sessionId: string, message: string): Promise<Message> {
        try {
            console.log(`Sending message to assistant ${chatAssistantId}, session ${sessionId}: ${message}`);

            // Validate inputs
            if (!chatAssistantId) {
                throw new Error('Chat assistant ID is required');
            }

            if (!sessionId) {
                throw new Error('Chat session ID is required');
            }

            if (!message.trim()) {
                throw new Error('Message cannot be empty');
            }

            // Make the API request
            const response = await this.fetchWithAuth(`/api/v1/chats/${chatAssistantId}/sessions/${sessionId}/messages`, {
                method: 'POST',
                body: JSON.stringify({
                    content: message
                })
            });

            // Validate response
            if (!response) {
                throw new Error('Empty response from RAGFlow API');
            }

            // Check for error response format
            if (response.code && response.message) {
                // If we get a 404, it means the chat assistant or session doesn't exist
                if (response.message.includes('404: Not Found')) {
                    throw new Error(`Chat assistant or session not found. The assistant or session may have been deleted.`);
                } else {
                    throw new Error(`RAGFlow API error: ${response.message} (code: ${response.code})`);
                }
            }

            if (!response.data) {
                throw new Error('Invalid response format: missing data field');
            }

            // Create and return the message object
            const responseMessage: Message = {
                role: 'assistant',
                content: response.data.content || 'No response from RAGFlow',
                reference: response.data.reference || []
            };

            console.log('Received response:', responseMessage);
            return responseMessage;
        } catch (error) {
            console.error('Failed to send message:', error);
            throw error;
        }
    }

    /**
     * Get the conversation history for a chat session
     */
    async getConversationHistory(chatAssistantId: string, sessionId: string): Promise<Message[]> {
        try {
            console.log(`Getting conversation history for assistant ${chatAssistantId}, session ${sessionId}`);

            // Validate inputs
            if (!chatAssistantId) {
                throw new Error('Chat assistant ID is required');
            }

            if (!sessionId) {
                throw new Error('Chat session ID is required');
            }

            // Make the API request
            const response = await this.fetchWithAuth(`/api/v1/chats/${chatAssistantId}/sessions/${sessionId}/messages`);

            // Validate response
            if (!response || !response.data || !Array.isArray(response.data)) {
                console.error('Invalid conversation history response:', response);
                return [];
            }

            // Map the response to Message objects
            return response.data.map((message: any) => ({
                role: message.role || 'assistant',
                content: message.content || '',
                reference: message.reference || []
            }));
        } catch (error) {
            console.error('Failed to get conversation history:', error);
            return [];
        }
    }

    /**
     * List all available chat assistants
     */
    async listChatAssistants(): Promise<ChatAssistant[]> {
        try {
            console.log('Listing chat assistants');
            const response = await this.fetchWithAuth('/api/v1/chats');

            if (!response || !response.data || !Array.isArray(response.data)) {
                console.error('Invalid chat assistants response:', response);
                return [];
            }

            return response.data.map((assistant: any) => ({
                id: assistant.id || '',
                name: assistant.name || 'Unnamed Assistant'
            }));
        } catch (error) {
            console.error('Error listing chat assistants:', error);
            return [];
        }
    }

    /**
     * Send a message to a chat assistant using the OpenAI-compatible completions endpoint
     * This uses the OpenAI-compatible endpoint as documented in RAGFlow API
     */
    async sendOpenAICompatibleMessage(chatAssistantId: string, question: string): Promise<{
        answer: string;
        sessionId: string;
        reference?: any[];
        processStream?: (callback: (chunk: string, done: boolean) => void) => Promise<{ fullContent: string; sessionId: string; reference: any[] }>
    }> {
        try {
            console.log(`Sending chat completion message to assistant ${chatAssistantId}: ${question}`);

            // Validate inputs
            if (!chatAssistantId) {
                throw new Error('Chat assistant ID is required');
            }

            if (!question.trim()) {
                throw new Error('Message cannot be empty');
            }

            // Prepare request body according to OpenAI-compatible API format
            const requestBody: any = {
                model: 'model', // The server will parse this automatically
                messages: [
                    {
                        role: 'user',
                        content: question
                    }
                ],
                stream: true // Enable streaming for better user experience
            };

            console.log('Sending OpenAI-compatible request with body:', JSON.stringify(requestBody));

            // Make the API request to the OpenAI-compatible endpoint
            const response = await this.fetchWithAuth(`/api/v1/chats_openai/${chatAssistantId}/chat/completions`, {
                method: 'POST',
                body: JSON.stringify(requestBody)
            });

            // Validate response
            if (!response) {
                throw new Error('Empty response from RAGFlow API');
            }

            // Check for error response format
            if (response.code && response.code !== 0 && response.message) {
                throw new Error(`RAGFlow API error: ${response.message} (code: ${response.code})`);
            }

            // For streaming responses, we need to return a special object that allows the caller to receive chunks
            console.log('Setting up streaming response handler');

            // Create a function that will process the response line by line
            const processStreamingResponse = async (callback: (chunk: string, done: boolean) => void) => {
                try {
                    // For streaming responses, we need to handle the ReadableStream
                    if (response instanceof Response && response.body && response.body instanceof ReadableStream) {
                        const reader = response.body.getReader();
                        const decoder = new TextDecoder('utf-8');
                        let buffer = '';
                        let fullContent = '';

                        while (true) {
                            const { done, value } = await reader.read();

                            if (done) {
                                // Process any remaining data in the buffer
                                if (buffer.trim()) {
                                    try {
                                        const lines = buffer.split('\n');
                                        for (const line of lines) {
                                            if (line.trim() && line.startsWith('data:')) {
                                                const jsonStr = line.replace('data:', '').trim();
                                                if (jsonStr === '[DONE]') continue;

                                                const jsonData = JSON.parse(jsonStr);
                                                if (jsonData.choices && jsonData.choices.length > 0) {
                                                    const delta = jsonData.choices[0].delta;
                                                    if (delta && delta.content) {
                                                        fullContent += delta.content;
                                                        callback(delta.content, false);
                                                    }
                                                }
                                            }
                                        }
                                    } catch (e) {
                                        console.error('Error processing buffer:', e);
                                    }
                                }

                                // Signal that we're done
                                callback('', true);
                                break;
                            }

                            // Decode the chunk and add it to our buffer
                            const chunk = decoder.decode(value, { stream: true });
                            buffer += chunk;

                            // Process complete lines in the buffer
                            const lines = buffer.split('\n');
                            buffer = lines.pop() || ''; // Keep the last (potentially incomplete) line in the buffer

                            for (const line of lines) {
                                if (line.trim() && line.startsWith('data:')) {
                                    try {
                                        const jsonStr = line.replace('data:', '').trim();
                                        if (jsonStr === '[DONE]') continue;

                                        const jsonData = JSON.parse(jsonStr);
                                        if (jsonData.choices && jsonData.choices.length > 0) {
                                            const delta = jsonData.choices[0].delta;
                                            if (delta && delta.content) {
                                                fullContent += delta.content;
                                                callback(delta.content, false);
                                            }
                                        }
                                    } catch (e) {
                                        console.error('Error processing line:', e, 'Line:', line);
                                    }
                                }
                            }
                        }

                        return { fullContent, sessionId: '', reference: [] };
                    } else {
                        // If it's not a streaming response, handle it as a regular response
                        console.log('Received non-streaming OpenAI-compatible response:', response);

                        // Check if we have a valid response
                        if (!response.choices || !Array.isArray(response.choices) || response.choices.length === 0) {
                            console.error('Invalid OpenAI-compatible response format:', response);
                            throw new Error('Invalid response format: missing choices');
                        }

                        // Extract the answer from the first choice
                        const firstChoice = response.choices[0];

                        if (!firstChoice.message || !firstChoice.message.content) {
                            console.error('Invalid choice format:', firstChoice);
                            throw new Error('Invalid choice format: missing message content');
                        }

                        const answer = firstChoice.message.content;
                        callback(answer, true);
                        return { fullContent: answer, sessionId: '', reference: [] };
                    }
                } catch (error) {
                    console.error('Error processing streaming response:', error);
                    callback(`Error: ${error.message}`, true);
                    throw error;
                }
            };

            // Return an object that allows the caller to process the streaming response
            return {
                answer: 'Streaming response...',
                sessionId: '',
                reference: [],
                processStream: processStreamingResponse
            };
        } catch (error) {
            console.error('Failed to send chat completion message:', error);
            throw error;
        }
    }

    /**
     * Test the connection to the RAGFlow API
     */
    async testConnection(): Promise<boolean> {
        try {
            // Try to list chat assistants as a simple API test
            await this.fetchWithAuth('/api/v1/chats');
            return true;
        } catch (error) {
            console.error('Connection test failed:', error);
            return false;
        }
    }
}
