import OpenAI from "openai";
import { Pinecone } from '@pinecone-database/pinecone'
import "dotenv/config";
import { Request as ExpressRequest, Response } from 'express';
import BotChats from '../../models/BotChats';




const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
if (!process.env.PINECONE_API_KEY || typeof process.env.PINECONE_API_KEY !== 'string') {
    throw new Error('Pinecone API key is not defined or is not a string.');
}
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

interface RequestWithChatId extends ExpressRequest {
    userChatId?: string;
}

export const chatResponse = async (req: RequestWithChatId, res: Response) => {

    console.log("req : ", req.body.chatId)
    const index = pc.index("dfccchatbot");
    const namespace = index.namespace('raja-test-pdf-upload-new')
    //raja-test-pdf-upload-new

    let userChatId = req.body.chatId || "";

    try {

        // chat id
        if (!userChatId) {
            const currentDate = new Date();
            const year = currentDate.getFullYear();
            const month = ('0' + (currentDate.getMonth() + 1)).slice(-2);
            const day = ('0' + currentDate.getDate()).slice(-2);
            const hours = ('0' + currentDate.getHours()).slice(-2);
            const minutes = ('0' + currentDate.getMinutes()).slice(-2);
            const seconds = ('0' + currentDate.getSeconds()).slice(-2);

            const prefix = 'chat';
            userChatId = `${prefix}_${year}${month}${day}_${hours}${minutes}${seconds}`;

            console.log("Generated chat id : ", userChatId);

        } else {
            console.log("Existing chat id : ", userChatId);
        }



        //============= get question ======================
        // get user message with history
        let chatHistory = req.body.messages || [];


        // Get the user question from the chat history
        let userQuestion = "";
        for (let i = chatHistory.length - 1; i >= 0; i--) {
            if (chatHistory[i].role === "user") {
                userQuestion = chatHistory[i].content;
                break;
            }
        }
        // console.log("userQuestion : ", userQuestion)

        await BotChats.create(
            { 
            message_id: userChatId,
            language: 'English',
            message: userQuestion,
            message_sent_by: 'customer',
            viewed_by_admin: 'no',
            },
        );


        let kValue = 2

        //============= change context ======================
        async function handleSearchRequest(userQuestion: string, kValue: number) {

        

            // ================================================================
            // STANDALONE QUESTION GENERATE
            // ================================================================
            const filteredChatHistory = chatHistory.filter((item: { role: string; }) => item.role !== 'system');

            const chatHistoryString = JSON.stringify(filteredChatHistory);



const questionRephrasePrompt = `As a senior banking assistant, kindly assess whether the FOLLOWUP QUESTION related to the CHAT HISTORY or if it introduces a new question. If the FOLLOWUP QUESTION is unrelated, refrain from rephrasing it. However, if it is related, please rephrase it as an independent query utilizing relevent keywords from the CHAT HISTORY, even if it is a question related to the calculation.
----------
CHAT HISTORY: {${chatHistoryString}}
----------
FOLLOWUP QUESTION: {${userQuestion}}
----------
Standalone question:`
            



            const completionQuestion = await openai.completions.create({
                model: "gpt-3.5-turbo-instruct",
                prompt: questionRephrasePrompt,
                max_tokens: 50,
                temperature: 0,
            });

            // console.log("chatHistory : ", chatHistory);
            // console.log("Standalone Question PROMPT :", questionRephrasePrompt)
            console.log("Standalone Question :", completionQuestion.choices[0].text)




            // =============================================================================
            // create embeddings
            const embedding = await openai.embeddings.create({
                model: "text-embedding-ada-002",
                input: completionQuestion.choices[0].text,
            });
            // console.log(embedding.data[0].embedding);




            // =============================================================================
            // query from pinecone
            // console.log('K - ', kValue)
            const queryResponse = await namespace.query({
                vector: embedding.data[0].embedding,
                topK: kValue,
                includeMetadata: true,
            });
            // console.log("VECTOR RESPONSE : ",queryResponse.matches)




            // =============================================================================
            // get vector documents into one string
            const results: string[] = [];
            // console.log("CONTEXT : ", queryResponse.matches[0].metadata);
            queryResponse.matches.forEach(match => {
                if (match.metadata && typeof match.metadata.Title === 'string') {
                    const result = `Title: ${match.metadata.Title}, \n Content: ${match.metadata.Text} \n \n `;
                    results.push(result);
                }
            });
            let context = results.join('\n');
            // console.log("CONTEXT : ", context);



            // set system prompt
            // =============================================================================
            if (chatHistory.length === 0 || chatHistory[0].role !== 'system') {
                chatHistory.unshift({ role: 'system', content: '' });
            }
            chatHistory[0].content = `You are a helpful assistant and you are friendly. Your name is Raja Jewellers GPT. Answer user question Only based on given Context: ${context}, your answer must be less than 150 words. If it has math question relevent to given Context give calculated answer, If user question is not relevent to the Context just say "I'm sorry.. no information documents found for data retrieval.". Do NOT make up any answers and questions not relevant to the context using public information.`;
            // console.log("Frontend Question : ", chatHistory);
        }



        // async function processRequest(userQuestion: string, userChatId: string) {
        await handleSearchRequest(userQuestion, kValue);


        // GPT response ===========================
        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: chatHistory,
            max_tokens: 180,
            temperature: 0
        });

        let botResponse = completion.choices[0].message.content
        console.log("GPT : ", botResponse);

       // Check if botResponse is not null and not undefined
if (botResponse != null && botResponse !== undefined) {
    // Regular expression to match a list
    const listRegex = /^\d+\.\s.*$/gm;

    // Check if botResponse contains a list
    if (listRegex.test(botResponse)) {
        console.log("List detected. Here's the list:");
        // Split botResponse by newline characters
        const lines = botResponse.split('\n');
        // Iterate over each line
        lines.forEach(line => {
            // If the line matches the list regex, print it
            if (listRegex.test(line)) {
                console.log(line);
            }
        });
    } else {
        console.log("No list detected in the bot response.");
    }
} else {
    console.log("botResponse is null or undefined.");
}
   

            // add assistant to array
            chatHistory.push({ role: 'assistant', content: botResponse });

            // console.log(" send chat id : ", userChatId)
            // }
            // await processRequest(userQuestion, userChatId);

            await BotChats.create(
                { 
                message_id: userChatId,
                language: 'English',
                message: botResponse,
                message_sent_by: 'bot',
                viewed_by_admin: 'no',
                },
            );

            res.json({ answer: botResponse, chatHistory: chatHistory, chatId: userChatId });

        

    } catch (error) {
        console.error("Error processing question:", error);
        res.status(500).json({ error: "An error occurred." });
    }





};







































