# 🚀 Optimización del Paquete Lambda

## Problema Original
- **Tamaño descomprimido**: 310 MB
- **Límite de AWS Lambda**: 250 MB
- **Error**: "Unzipped size must be smaller than 262144000 bytes"

## Solución Implementada

Se configuró `serverless-esbuild` para optimizar el empaquetado mediante bundling inteligente.

### Estrategia de Optimización

#### 1️⃣ **Dependencias External (incluidas como node_modules)**
Estas NO se bundlearán debido a binarios nativos o complejidad:

**Módulos Nativos:**
- `bcrypt` - Binarios C++ para hashing
- `pg` - Driver nativo PostgreSQL
- `pdfjs-dist` - Procesa PDFs con workers

**SDKs Externos:**
- `@google-cloud/storage`
- `@pinecone-database/pinecone`
- `@paddle/paddle-node-sdk`

**NestJS Framework:**
- `@nestjs/common`
- `@nestjs/core`
- `@nestjs/platform-express`
- `@nestjs/config`
- `@nestjs/jwt`
- `@nestjs/passport`
- `@nestjs/typeorm`
- `@nestjs/throttler`
- `@nestjs/schedule`
- `@nestjs/swagger`

**ORM y Reflexión:**
- `typeorm`
- `reflect-metadata`
- `class-transformer`
- `class-validator`

**Otros:**
- `multer` - File uploads

#### 2️⃣ **Dependencias Bundleadas (optimizadas por esbuild)**
Estas se empaquetarán en un archivo optimizado:

- `axios`
- `cors`
- `helmet`
- `cookie-parser`
- `uuid`
- `zod`
- `rxjs`
- `openai`
- `serverless-http`
- `passport`
- `passport-jwt`
- `passport-local`

#### 3️⃣ **Excluidas Completamente**
No se incluirán en el paquete:

- `aws-sdk` (ya está en Lambda)
- `@nestjs/cli` (solo desarrollo)
- `@types/*` (solo desarrollo)

### Archivos Excluidos del Paquete

```
❌ src/          (código fuente TypeScript)
❌ test/         (tests)
❌ uploads/      (archivos subidos por usuarios)
❌ *.pdf         (archivos PDF sueltos)
❌ .env*         (variables de entorno)
❌ .git/         (repositorio git)
❌ README*.md    (documentación)
❌ *.config.*    (configs de desarrollo)
❌ tsconfig.json (configuración TypeScript)
```

## Resultado Esperado

### Tamaño Estimado Final
- **Antes**: ~310 MB descomprimido
- **Después**: ~40-60 MB descomprimido ✅
- **Reducción**: ~80-85%

### Beneficios Adicionales
1. ✅ Cold starts más rápidos (menos archivos que cargar)
2. ✅ Código minificado y optimizado
3. ✅ Tree-shaking automático (solo código usado)
4. ✅ Deployments más rápidos (paquete más pequeño)

## Comandos de Despliegue

```bash
# Empaquetar sin desplegar (para revisar)
npm run build
npx serverless package

# Revisar el tamaño del paquete
cd .serverless
Get-Item *.zip | Select-Object Name, @{Name="SizeMB";Expression={[math]::Round($_.Length/1MB,2)}}

# Desplegar a AWS
npx serverless deploy --stage dev --region us-east-1
```

## Verificación Post-Despliegue

Después del despliegue exitoso:

1. Verificar el tamaño en AWS Lambda Console
2. Probar endpoints principales
3. Revisar CloudWatch Logs para errores
4. Medir cold start time

## Troubleshooting

### Si hay errores de módulos no encontrados:
Agregar el módulo a la lista `external` en `serverless.yml`

### Si el paquete sigue siendo grande:
- Revisar qué módulos ocupan más espacio
- Considerar usar Lambda Layers para dependencias pesadas
- Evaluar alternativas más ligeras a dependencias pesadas

### Si hay errores en runtime:
Verificar que módulos nativos estén en la lista `external`

## Notas Importantes

⚠️ **Módulos con binarios nativos** SIEMPRE deben ser external
⚠️ **NestJS** funciona mejor sin bundling completo
⚠️ **TypeORM** requiere estar external por sus decoradores
⚠️ **pdfjs-dist** usa dynamic imports que no se pueden bundlear

## Optimizaciones Futuras (Opcionales)

1. **Lambda Layers**: Mover dependencias pesadas a layers compartidas
2. **Separar funciones**: Dividir en múltiples Lambdas según funcionalidad
3. **Caché de dependencias**: Usar Layer con node_modules común
4. **Código condicional**: Lazy loading de módulos pesados

---

**Última actualización**: 2025-10-20
**Configurado por**: serverless-esbuild v1.55.1
