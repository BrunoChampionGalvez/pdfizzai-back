# 🚀 Configuración de Variables de Entorno para AWS Lambda

## 📁 Archivos de Entorno

Este proyecto usa archivos `.env` separados para desarrollo y producción:

- **`.env`** - Variables para desarrollo local (ya existe)
- **`.env.production`** - Variables para AWS Lambda (creado, necesita completarse)

## ⚙️ Configuración Automática

El archivo `serverless.yml` está configurado con el plugin `serverless-dotenv-plugin` que automáticamente:

1. Lee el archivo `.env.production` durante el deploy
2. Carga todas las variables especificadas
3. Las inyecta como variables de entorno en Lambda

## 📝 Pasos para Desplegar

### 1. Completar `.env.production`

Edita el archivo `.env.production` y reemplaza todos los valores placeholder con tus valores reales de producción:

```bash
# Database (RDS PostgreSQL)
DB_HOST=tu-base-datos-produccion.rds.amazonaws.com
DB_PASSWORD=tu-password-seguro

# APIs
OPENAI_API_KEY=sk-tu-key-real
GEMINI_API_KEY=tu-gemini-key
# ... etc
```

### 2. Desplegar a AWS

```bash
cd back
npx serverless deploy --stage dev --region us-east-1
```

El plugin cargará automáticamente las variables de `.env.production`.

### 3. Verificar Variables en Lambda

Puedes verificar que las variables se cargaron correctamente en:
- AWS Console → Lambda → tu función → Configuration → Environment variables

## 🔒 Seguridad

- ✅ `.env.production` está en `.gitignore` (NO se sube al repositorio)
- ✅ Las variables se inyectan durante el build
- ✅ Solo existen en AWS Lambda, no en el código fuente

## 📋 Variables Requeridas

El despliegue requiere estas variables (ver `.env.production`):

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DB_HOST` | Host de PostgreSQL | `db.example.com` |
| `DB_PORT` | Puerto de PostgreSQL | `5432` |
| `DB_USERNAME` | Usuario de DB | `postgres` |
| `DB_PASSWORD` | Password de DB | `secure-password` |
| `DB_NAME` | Nombre de la base de datos | `pdfizzai_production` |
| `JWT_SECRET` | Secret para tokens JWT | `random-secure-string` |
| `FRONTEND_URL` | URL del frontend | `https://refdocai.vercel.app` |
| `OPENAI_API_KEY` | API key de OpenAI | `sk-...` |
| `GEMINI_API_KEY` | API key de Gemini | `AI...` |
| `GCS_*` | Credenciales de Google Cloud Storage | varios |
| `PINECONE_*` | Credenciales de Pinecone | varios |
| `PADDLE_API_KEY` | API key de Paddle | `live_...` |

## 🔧 Troubleshooting

### Error: "Internal Server Error" después del deploy

**Causa**: Variables de entorno faltantes o incorrectas

**Solución**: 
1. Verifica que `.env.production` tenga TODAS las variables con valores reales
2. Redeploy: `npx serverless deploy --stage dev --region us-east-1`
3. Revisa los logs: `npx serverless logs -f api --stage dev --region us-east-1`

### Ver logs en tiempo real

```bash
npx serverless logs -f api --stage dev --region us-east-1 --tail
```

## 📦 Información del Paquete

- **Tamaño actual**: ~88 MB (comprimido)
- **Límite de Lambda**: 250 MB (descomprimido), 50 MB (comprimido)
- **Estado**: ✅ Dentro de los límites
