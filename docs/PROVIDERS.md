# LLM Providers

El orchestrator soporta múltiples proveedores LLM, todos intercambiables vía la variable de entorno `LLM_PROVIDER`. No hay default hardcodeado: si no configuras uno, la app falla al arrancar.

## Proveedores soportados

| Provider    | Tipo                | Configurar                          | Mejor para                       |
|-------------|---------------------|-------------------------------------|----------------------------------|
| `anthropic` | Claude API oficial  | `ANTHROPIC_API_KEY`                 | Tool calling estructurado        |
| `openai`    | OpenAI API oficial  | `OPENAI_API_KEY`                    | Function calling                 |
| `ollama`    | Local HTTP (OpenAI-compatible) | `OLLAMA_BASE_URL`        | Datos sensibles / sin nube       |
| `minimax`   | Minimax M3 (OpenAI-compatible) | `MINIMAX_API_KEY` + `MINIMAX_BASE_URL` | API de Minimax M3 |
| `gemini`    | Google AI Studio (OpenAI-compatible) | `GEMINI_API_KEY` + `GEMINI_BASE_URL` | Gemini Pro / Flash |

## Cómo cambiar de provider

1. Edita `.env`:
   ```env
   LLM_PROVIDER=gemini
   LLM_MODEL=gemini-3.1-pro-preview
   GEMINI_API_KEY=tu-api-key-de-https://aistudio.google.com/apikey
   ```

2. Reinicia el orchestrator:
   ```bash
   docker-compose restart orchestrator
   # o si corre local:
   # Ctrl+C y `npm run dev` de nuevo
   ```

3. Verifica:
   ```bash
   curl http://localhost:4000/health
   # → debe mostrar "llm_provider":"gemini", "llm_model":"gemini-3.1-pro-preview"
   ```

## Agregar un nuevo provider

1. Implementa la interfaz en `orchestrator/src/llm/<nombre>-provider.ts`:
   ```typescript
   import type { LlmProvider, LlmMessage, LlmResponse, ToolDefinition } from './provider.js';

   export class MiProvider implements LlmProvider {
     readonly name = 'mi-provider';

     async generate(
       messages: LlmMessage[],
       options: { tools?: ToolDefinition[]; system?: string; model?: string; max_tokens?: number }
     ): Promise<LlmResponse> {
       // ...
     }
   }
   ```

2. Agrega las variables necesarias en `orchestrator/src/config.ts` (zod schema).

3. Registra el caso en `orchestrator/src/llm/factory.ts`.

4. Agrega tests en `orchestrator/tests/unit/`.

5. Documenta en este archivo.

## Compatibilidad: OpenAI vs Anthropic

| Feature | Anthropic | OpenAI-compatible (Ollama, Minimax M3, OpenAI) |
|---------|-----------|-------------------------------------------------|
| Tool calling format | `tool_use` blocks + `tool_result` blocks | `tool_calls` JSON + `tool` role messages |
| System message | Header `system` separado | Mensaje con role `system` |
| Function args | Object inline | JSON string (hay que parsearlo) |

El orchestrator abstrae estas diferencias en la interfaz `LlmProvider`. Cada adapter se encarga de traducir.

## Modelo por defecto

No hay modelo por defecto. Debes especificar `LLM_MODEL` siempre.

Recomendaciones:
- **Anthropic**: `claude-sonnet-4-5`, `claude-opus-4-8`, `claude-haiku-4-5`
- **OpenAI**: `gpt-4o`, `gpt-5`, `o1`
- **Ollama**: `llama3.1`, `qwen2.5`, `mistral`
- **Minimax M3**: `MiniMax-M3`
- **Gemini (Google AI Studio)**: `gemini-3.1-pro-preview` (Pro más capaz), `gemini-3.7-flash` (rápido)
