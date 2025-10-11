# PDFizzAI — Backend (API)

Frontend en producción: https://pdfizzai.vercel.app/

## Propósito
API para autenticación, subida y procesamiento de PDFs, extracción/conversión a embeddings, chat con IA con referencias clicables y pagos.

## Tech stack
- NestJS
- PostgreSQL
- OpenAI
- Gemini
- Pinecone
- Paddle (payment gateway)
- Next.js (Frontend)
- Tailwind CSS v4

## Cómo correrlo localmente
Requisitos:
- Node.js 18+
- PostgreSQL en ejecución y base de datos creada (ver variables DB_*)

Pasos:
1. Instalar dependencias: `npm install`
2. Copiar `.env.example` a `.env` y completar variables (ver “Configuración rápida”).
3. Iniciar en desarrollo: `npm run start:dev`
4. La API quedará en http://localhost:3001

## Configuración rápida (variables de entorno)
Crear un archivo `.env` con:

- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`: conexión a PostgreSQL.
- `JWT_SECRET`: secreto para firmar JWT.
- `PORT`, `NODE_ENV`: puerto y entorno (dev/prod).
- `FRONTEND_URL`: origen permitido para CORS del frontend.
- `ALLOWED_IPS`: lista de IPs permitidas (producción, separado por comas).
- `OPENAI_API_KEY`: clave para OpenAI.
- `GEMINI_API_KEY`: clave para Google Gemini.
- `AI_SERVICE_URL`, `AI_SERVICE_API_KEY`: servicio interno de IA (opcional/placeholder).
- `GCS_BUCKET_NAME`, `GCS_ACCESS_TOKEN`, `GCS_API_KEY`, `GCS_PROJECT_ID`, `GCS_SERVICE_ACCOUNT_ENCODED`: configuración de Google Cloud Storage.
- `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`, `PINECONE_INDEX_HOST`: configuración de Pinecone.
- `PADDLE_API_KEY`: clave secreta de Paddle (servidor).

Ejemplo:

```
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=refdoc_ai

JWT_SECRET=tu-jwt-secret

PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
ALLOWED_IPS=127.0.0.1

OPENAI_API_KEY=tu-openai-api-key
GEMINI_API_KEY=tu-gemini-api-key

AI_SERVICE_URL=http://localhost:8000
AI_SERVICE_API_KEY=tu-ai-service-api-key

GCS_BUCKET_NAME=tu-bucket
GCS_ACCESS_TOKEN=tu-gcs-access-token
GCS_API_KEY=tu-gcs-api-key
GCS_PROJECT_ID=tu-proyecto-gcp
GCS_SERVICE_ACCOUNT_ENCODED=tu-service-account-base64

PINECONE_API_KEY=tu-pinecone-api-key
PINECONE_INDEX_NAME=refdoc-ai
PINECONE_INDEX_HOST=tu-pinecone-index-host

PADDLE_API_KEY=tu-paddle-secret-key
```
