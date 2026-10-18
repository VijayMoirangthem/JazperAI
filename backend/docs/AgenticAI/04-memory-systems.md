# 04 — Memory Systems

## Summary
Memory is what separates an agent that feels intelligent from one that feels like a blank slate every session. There are 6 types of agent memory. Jazper currently has 2. This document explains all 6 and how to build the remaining 4.

---

## 1. Why Memory Is Hard

The LLM itself has no memory. Every API call starts with a blank state. The context window (what you pass in the messages array) is the only memory the LLM has access to during inference.

**The fundamental tension:**
- You want the agent to remember everything about you
- The context window is finite (e.g., 128K tokens ≈ ~100K words)
- Injecting too much context makes it slow and expensive
- Injecting too little makes it ignorant

**The solution:** Multiple memory stores, each optimized for different types of information, with smart retrieval to inject only what's relevant to the current query.

---

## 2. The 6 Types of Agent Memory

```
┌──────────────────────────────────────────────────────────────┐
│                    MEMORY ECOSYSTEM                          │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  WORKING    │  │  EPISODIC   │  │     SEMANTIC        │  │
│  │  MEMORY     │  │  MEMORY     │  │     MEMORY          │  │
│  │             │  │             │  │                     │  │
│  │ Context     │  │ "What       │  │ "What I know        │  │
│  │ window,     │  │ happened"   │  │ about the world"    │  │
│  │ current     │  │ Events,     │  │ Facts, knowledge,   │  │
│  │ session     │  │ outcomes,   │  │ vector embeddings   │  │
│  │             │  │ actions     │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  PROCEDURAL │  │  DECLARATIVE│  │      CACHE          │  │
│  │  MEMORY     │  │  MEMORY     │  │                     │  │
│  │             │  │  (Core)     │  │ Recent LLM          │  │
│  │ "How to do  │  │             │  │ responses,          │  │
│  │ things"     │  │ Facts about │  │ semantic            │  │
│  │ Learned     │  │ user, prefs,│  │ deduplication       │  │
│  │ workflows   │  │ identity    │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

### Type 1: Working Memory (Context Window)

**What it is:** The messages array passed to the LLM on each call. Everything the model can "see" right now.

**Characteristics:**
- Fastest (no retrieval needed, it's already there)
- Most expensive (every token costs compute)
- Ephemeral — gone when the session ends
- Limited — you can't fit everything

**What to put here:**
- System prompt + agent persona
- Current task/goal
- Last 5-10 conversation turns
- Tool results from this session
- Relevant retrieved memories (from other stores)

**Context engineering** — deciding what goes in the window — is a core skill:

```python
def build_context(user_message, session_id, goal):
    context = []
    
    # Always include
    context.append(SYSTEM_PROMPT)
    
    # Include recent conversation (last 10 turns)
    context += get_recent_messages(session_id, limit=10)
    
    # Retrieve relevant memories (smart selection)
    relevant = semantic_search(user_message, limit=5)
    context += format_memories(relevant)
    
    # Current message
    context.append({"role": "user", "content": user_message})
    
    # Trim if over token limit
    return trim_to_token_limit(context, max_tokens=8000)
```

**Jazper status:** ✅ Implemented — session messages, core memories, long-term memories all injected.

---

### Type 2: Episodic Memory

**What it is:** A record of events — what the agent did, when, and what happened. "I did X, it resulted in Y."

**Human analogy:** Like your autobiographical memory. "Last Tuesday I had a meeting with Sarah and she mentioned the project deadline moved."

**What to store:**
- Task executions and outcomes ("job apply run on 2026-05-20: found 12 jobs, applied to 4, 3 failed")
- Conversation summaries ("Vijay asked me to research ML jobs in Singapore")
- Agent actions and their results
- Notable events ("Vijay got an interview at TechCorp on 2026-05-15")

**Storage:** Regular PostgreSQL rows with timestamps.

**Retrieval:**
- By time ("what happened this week?")
- By entity ("what happened with TechCorp?")
- By type ("all job application events")

**Jazper status:** ⚠️ Partial — `job_apply_runs` table exists for job apply events. General episodic memory not yet implemented.

**What to build:** An `agent_episodes` table:
```sql
CREATE TABLE agent_episodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID,
    episode_type TEXT,          -- 'task', 'conversation', 'action', 'event'
    summary TEXT NOT NULL,      -- Natural language description
    entities TEXT[],            -- ['TechCorp', 'job application', ...]
    outcome TEXT,               -- 'success', 'failure', 'pending'
    embedding VECTOR(768),      -- For semantic retrieval
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### Type 3: Semantic Memory (Knowledge Base)

**What it is:** Facts and knowledge represented as vector embeddings. Retrieved by *meaning*, not exact keyword match.

**Human analogy:** Your general knowledge — you "know" things about the world that you can recall when relevant.

**Why embeddings?** Text is converted to a high-dimensional vector (list of numbers) where semantically similar text ends up "close" in that vector space.

```
"I like working remotely" → [0.23, -0.45, 0.67, ...]
"I prefer remote work"   → [0.21, -0.43, 0.65, ...]  ← Very close!
"I enjoy tennis"         → [0.89, 0.12, -0.33, ...]  ← Far away
```

When you ask about "my work preferences", the system finds the most similar vectors — even if the exact words don't match.

**What to store:**
- Everything you tell Jazper about yourself
- Your resume content
- Preferences, goals, values
- Knowledge you want Jazper to have (company info, field knowledge)

**Storage:** PostgreSQL with the `pgvector` extension (you already have this installed).

**Schema:**
```sql
CREATE TABLE semantic_memories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content TEXT NOT NULL,
    embedding VECTOR(768),
    source TEXT,                -- 'user_statement', 'document', 'extracted'
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Approximate nearest neighbor index for fast retrieval
CREATE INDEX ON semantic_memories USING ivfflat (embedding vector_cosine_ops);
```

**Retrieval:**
```python
async def semantic_search(query: str, limit: int = 5) -> list[str]:
    query_embedding = await embed(query)
    
    rows = await db.fetch("""
        SELECT content, 1 - (embedding <=> $1::vector) AS similarity
        FROM semantic_memories
        ORDER BY embedding <=> $1::vector
        LIMIT $2
    """, query_embedding, limit)
    
    return [r["content"] for r in rows if r["similarity"] > 0.75]
```

**The embedding model:** You need a separate small model to convert text to vectors. Options:
- `sentence-transformers/all-MiniLM-L6-v2` (fast, lightweight, 384-dim, local)
- `nomic-embed-text` (better quality, available in LM Studio/Ollama)
- OpenAI `text-embedding-3-small` (cloud, very good, costs money)

For Jazper: Use a local embedding model (privacy, no cost, no latency to external API).

**Jazper status:** ❌ Not yet implemented. `extracted_memories` exists but uses keyword search. **This is Phase 1 of the agentic upgrade.**

---

### Type 4: Procedural Memory

**What it is:** Learned workflows, preferences, and patterns. "How to do things" — shaped by experience.

**Human analogy:** Muscle memory, learned skills. You don't re-learn to type every time.

**For Jazper:** Rules and preferences learned from interactions:
- "Vijay prefers bullet points over prose for technical summaries"
- "When searching jobs, always filter for remote first"
- "Cover letters should lead with a specific achievement, not a generic opener"
- "Vijay doesn't like to be asked for confirmation on read-only tasks"

**Storage:** A structured table with rules/patterns:
```sql
CREATE TABLE procedural_memories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trigger TEXT,               -- When this applies ("when writing cover letters")
    rule TEXT NOT NULL,         -- The learned behavior
    confidence FLOAT DEFAULT 1.0,
    source TEXT,                -- 'user_explicit', 'inferred', 'reflexion'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Injection:** Always inject applicable procedural memories into system prompt:
```
You have learned these preferences from working with Vijay:
- Cover letters: Lead with a specific achievement, not "I am excited to apply..."
- Job search: Always filter remote first
- Summaries: Use bullet points, not prose
```

**Population:** Two ways:
1. Explicit — user tells you ("always filter remote jobs first")
2. Reflexion — agent infers from patterns ("Vijay always changed the opening line, so I'll change how I write them")

**Jazper status:** ❌ Not yet implemented. Partially done via `core_memories` but not structured as rules.

---

### Type 5: Declarative Memory (Core Facts)

**What it is:** Explicit facts about the user — static or slowly-changing information.

**This is what Jazper's `core_memories` table is.** The difference from semantic memory is:
- Declarative = specific facts (name, location, current role)
- Semantic = general knowledge (everything, retrieved by meaning)

**What goes here:**
- Name, location, contact info
- Current job/role, experience level
- Skills, technologies
- Career goals
- Education
- Key relationships

**Format:** Either free-text or structured JSON:
```json
{
  "name": "Vijay Moirangthem",
  "location": "Singapore",
  "current_role": "Software Engineer",
  "skills": ["Python", "FastAPI", "React", "TypeScript", "PostgreSQL"],
  "target_roles": ["Senior Engineer", "ML Engineer", "Agentic AI Developer"],
  "experience_years": 4,
  "preferences": {
    "work_mode": "remote",
    "salary_min": 120000
  }
}
```

**Jazper status:** ✅ Implemented — `core_memories` + `user_profile` tables.

---

### Type 6: Cache Memory

**What it is:** Storing recent LLM responses to avoid redundant computation. Semantic deduplication.

**Two flavors:**

**Response cache:** If the same (or very similar) question is asked again, return the cached answer:
```python
query_embedding = embed(user_message)
cached = db.find_similar_query(query_embedding, threshold=0.95)
if cached and cached.is_fresh:
    return cached.response  # Skip LLM call entirely
```

**Semantic LLM cache:** Cache by *meaning*, not exact string:
- "What's the weather in Singapore?" == "Singapore weather today?"
- One LLM call serves both

**Jazper status:** ❌ Not yet implemented. Low priority until volume is high.

---

## 3. Memory Retrieval Strategies

Getting memory *in* is easy. Getting the *right* memory *out* is hard.

### Strategy 1: Keyword Search (Current Jazper)
```sql
SELECT content FROM extracted_memories 
WHERE content ILIKE '%remote%' OR content ILIKE '%job%'
```
**Problem:** Misses semantic matches. "I prefer working from home" won't match "remote."

### Strategy 2: Vector Similarity (Target)
```python
query_vec = embed("what are my job preferences?")
results = db.vector_search(query_vec, table="semantic_memories", top_k=5)
```
**Better:** Finds semantically related content regardless of exact wording.

### Strategy 3: Hybrid Search
Combine keyword (for exact matches) + vector (for semantic matches), merge results:
```python
keyword_results = keyword_search(query, limit=10)
vector_results = vector_search(embed(query), limit=10)
merged = reciprocal_rank_fusion(keyword_results, vector_results)
return merged[:5]
```
**Best of both worlds.** Used in production RAG systems.

### Strategy 4: Structured Retrieval
For episodic/procedural memory, use structured queries:
```python
# "What happened last week with job applications?"
episodes = db.query("""
    SELECT * FROM agent_episodes 
    WHERE episode_type = 'job_apply' 
    AND created_at > NOW() - INTERVAL '7 days'
    ORDER BY created_at DESC
""")
```

### Strategy 5: Memory Fusion (Advanced)
Run multiple retrieval strategies, have the LLM rank/filter which memories are actually relevant:
```python
candidates = keyword_search(query) + vector_search(query)
relevant = llm.filter_relevant(candidates, query, max_keep=5)
```

---

## 4. Memory Lifecycle

```
Information arrives
       │
       ▼
┌──────────────┐
│ ENCODE       │  Convert to storage format (text, embedding, structured)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ STORE        │  Write to appropriate memory type/table
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ CONSOLIDATE  │  Merge duplicates, update existing, summarize old episodes
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ RETRIEVE     │  Find relevant memories for current query
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ INJECT       │  Add to context window for LLM
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ FORGET       │  Expire old/irrelevant memories (time-based, LRU)
└──────────────┘
```

**Forgetting is important:** Without expiry, memory grows unbounded and old irrelevant facts pollute retrieval. Add `expires_at` to non-permanent memories.

---

## 5. Jazper Memory Upgrade Plan

### Phase 1: Semantic Memory with pgvector
**What:** Add vector embeddings to `extracted_memories`. Replace keyword search with vector search.
**Impact:** Massive improvement in memory retrieval relevance.
**Effort:** 1-2 days.

```python
# Add to existing extracted_memories table
ALTER TABLE extracted_memories ADD COLUMN embedding VECTOR(768);

# Embed when storing
async def store_memory(content: str):
    embedding = await embed_local(content)
    db.insert("extracted_memories", content=content, embedding=embedding)

# Semantic search instead of LIKE
async def search_memories(query: str, limit=5):
    query_embedding = await embed_local(query)
    return db.query("""
        SELECT content FROM extracted_memories
        ORDER BY embedding <=> %s::vector
        LIMIT %s
    """, [query_embedding, limit])
```

### Phase 2: Episodic Memory
**What:** Store summaries of every significant interaction/task.
**Impact:** Jazper "remembers" what happened — conversation history becomes meaningful.
**Effort:** 2-3 days.

### Phase 3: Procedural Memory
**What:** Extract and store learned preferences/rules. Inject into system prompt.
**Impact:** Jazper gets better at your preferences over time.
**Effort:** 3-4 days.

---

## 6. Key Interview Concepts

**RAG (Retrieval Augmented Generation):** The pattern of retrieving relevant documents/memories and injecting them into the LLM context before generation. Jazper's memory system IS a personalized RAG system.

**Embedding:** A dense vector representation of text. Texts with similar meaning have similar embeddings (nearby in vector space). Computed by a separate embedding model.

**pgvector:** PostgreSQL extension for storing and querying vector embeddings. Supports cosine similarity, L2 distance, dot product. Already in Jazper's DB.

**Chunking:** Long documents must be split into smaller pieces before embedding. Each chunk gets its own vector. Too large = lost signal, too small = lost context.

**Context Engineering:** The discipline of deciding what to include in the LLM's context window for maximum relevance and minimum noise. Critical for agent quality.

**Memory Consolidation:** Periodically summarizing old memories into higher-level abstractions. Like how humans remember "I had a good time in Singapore" not every individual moment.

---

## Next: [05 — Tools & Tool Loops](./05-tools-and-tool-loops.md)
