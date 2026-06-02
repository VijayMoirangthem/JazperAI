Here's how to test each layer of what was just built:

1. Test the ReAct Loop (Multi-step tool chaining)
These prompts should trigger multiple tool calls in one turn. Watch the [SEARCHING] status indicators in the chat — you should see 2+ appear before the final answer.

Web search chaining:


"Search for the latest AI news today, then also search for what OpenAI announced this week. Give me a combined summary."
Expected: 2× web_search calls, then one synthesized answer.


"What's the current Python version and what are the new features in it?"
Expected: web_search → answer (no second query needed, but model may search twice for accuracy).

Email → action chaining:


"Check my latest emails and then archive any promotional ones"
Expected: read_email → model decides which are promotional → archive_email (2 tools).

2. Test Semantic Memory
First, seed some memories by having a few conversations:


Turn 1: "I prefer concise bullet-point answers over long paragraphs"
Turn 2: "I'm targeting Senior Backend Engineer roles in Singapore"  
Turn 3: "My main stack is Python, FastAPI, PostgreSQL, and React"
Then start a fresh session and ask something related but worded differently:


"What kind of roles should I apply for?"
Expected: Jazper knows your target roles from memory even though you didn't say it in this session.


"How should I format your responses?"
Expected: Jazper recalls the bullet-point preference.

The real semantic test — use completely different words:


# You stored: "I like working from home"
# Now ask:
"What are my remote work preferences?"
Old keyword search would miss this. Semantic search finds it because the vectors are close.

3. Test True Multi-step Research (The Agentic Showcase)
This is the best test — a complex goal that requires multiple searches + synthesis:


"Research Anthropic as a company — what they do, their latest models, and whether they'd be a good company for a backend AI engineer to join"
Expected behavior:

Search 1: "Anthropic company overview 2026"
Search 2: "Anthropic latest AI models 2026"
Search 3: "Anthropic hiring backend engineer"
Final: Synthesized answer across all 3 searches
Watch the sidebar — you should see 3 separate [SEARCHING] status messages flash.

4. Check It in the Logs Panel
Open Logs in the sidebar while testing. You'll see:


tool_call_start  tool=web_search  step=1
tool_call_start  tool=web_search  step=2
tool_call_start  tool=web_search  step=3
If you only see one tool_call_start before the answer — old single-pass behavior. Three means ReAct loop is working.

5. Test Semantic Memory Storage
After a chat session, check your database directly:


-- Run in your PostgreSQL client
SELECT content, created_at 
FROM semantic_memories 
ORDER BY created_at DESC 
LIMIT 5;

SELECT content, created_at 
FROM extracted_memories 
WHERE embedding IS NOT NULL
ORDER BY created_at DESC 
LIMIT 5;
The extracted_memories rows having non-null embedding confirms local embeddings are working. If embedding is null on recent rows, the model hasn't loaded yet — check backend logs for "Embedding model loaded".

6. Confirm the Model Downloaded
On first message after restart, the backend logs should show:


Embedding model loaded  model=all-MiniLM-L6-v2  dim=384
If you see this — everything is working. If not, check the Logs panel for any error from embedding_service.py.

Quick sanity order:

Restart backend → send any message → check logs for Embedding model loaded
Ask "search for X and also search for Y" → verify 2 [SEARCHING] indicators
Tell Jazper a preference → new session → ask something related → verify it remembers