# Contribución

¡Gracias por tu interés en contribuir al AI Website Agent! 🎉

## Principios rectores

1. **Seguridad ante todo**: la IA nunca toca la BD directamente. Cualquier PR debe mantener este invariante.
2. **Reversibilidad**: cada cambio debe poder revertirse. Snapshots y rollback son obligatorios.
3. **Human-in-the-loop**: ninguna acción destructiva se ejecuta sin aprobación explícita.
4. **Transparencia**: cada operación se registra en audit log.
5. **Compatibilidad**: detecta dinámicamente WP y Elementor — no asumas.

## Flujo de trabajo

```bash
# 1. Fork y clonar
git clone <your-fork>
cd ai-website-agent

# 2. Crear rama feature
git checkout -b feat/mi-feature

# 3. Setup
cp .env.example .env
# Editar .env (agregar tu LLM API key)
make up
make install

# 4. Desarrollar
# ... hacer cambios ...

# 5. Tests + lint
make lint
make test-orchestrator

# 6. Commit (Conventional Commits)
git commit -m "feat(plugin): add preview endpoint"

# 7. Push + PR
git push origin feat/mi-feature
gh pr create
```

## Conventional Commits

Usa el formato `tipo(scope): descripción`:

- `feat(plugin): add new endpoint`
- `fix(orchestrator): handle missing API key`
- `docs(api): document /preview endpoint`
- `test(plugin): add Validator tests`
- `refactor(frontend): split Chat component`
- `chore(deps): upgrade Next.js`

Tipos: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `style`, `perf`.

## Estilo de código

### PHP (Plugin)
- **PSR-4** autoload.
- **WordPress Coding Standards** (WPCS).
- Type declarations siempre que sea posible.
- `declare(strict_types=1);` al inicio.
- Prefijos: `ai_agent_` para options, `_` para hooks privados.

### TypeScript (Orchestrator + Frontend)
- `strict: true` en tsconfig.
- ESM modules (`import/export`).
- Type hints completos — no `any` salvo caso excepcional comentado.
- Errores estructurados: `{ code, message, details? }`.

### React (Frontend)
- App Router.
- Server Components por defecto, Client Components solo cuando hay estado.
- Hooks en el orden correcto.
- Nombres de archivos en kebab-case o PascalCase según convención Next.js.

## Tests

- Toda nueva feature DEBE tener tests.
- Toda nueva tool del orchestrator DEBE estar en `tools.test.ts`.
- Toda nueva operación del plugin DEBE tener un test del Adapter.
- Los tests E2E siguen los criterios del SRS §42.

## Code review

Antes de mergear, verifica:

- [ ] Pasa `make lint`
- [ ] Pasan tests unitarios
- [ ] Hay tests para la nueva feature
- [ ] No se introduce acceso directo a BD
- [ ] Se mantiene el approval gate
- [ ] El audit log captura la nueva acción
- [ ] La documentación está actualizada

## Seguridad

Si encuentras una vulnerabilidad, NO abras un issue público. Envíala en privado al mantenedor principal.

## Licencia

Al contribuir, aceptas que tu código se distribuye bajo la licencia MIT.
