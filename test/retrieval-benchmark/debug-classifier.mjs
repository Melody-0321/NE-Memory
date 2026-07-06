import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

var __dirname = dirname(fileURLToPath(import.meta.url));
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));

var URL = config.judge_v4.url;
var MODEL = config.judge_v4.model;
var KEY = config.judge_v4.key;

console.log('URL:', URL);
console.log('Model:', MODEL);
console.log('Key prefix:', KEY.substring(0, 10) + '...');

var response = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
    body: JSON.stringify({
        model: MODEL,
        messages: [
            { role: 'system', content: 'Say only: {"test": true}' },
            { role: 'user', content: 'hello' },
        ],
        temperature: 0,
        max_tokens: 200,
    }),
});

console.log('Status:', response.status, response.statusText);
var data = await response.json();
console.log('Full response:', JSON.stringify(data, null, 2));
console.log('choices[0].message:', JSON.stringify(data.choices[0].message));
console.log('message.content:', data.choices[0].message.content);
