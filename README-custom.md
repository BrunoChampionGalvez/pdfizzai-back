# Refery AI Backend

Backend API for Refery AI - an application for uploading PDFs and chatting with AI about their contents.

## Technologies

- NestJS: A progressive Node.js framework for building efficient and scalable server-side applications.
- TypeORM: An ORM that can run in NodeJS and supports PostgreSQL.
- PostgreSQL: A powerful, open source object-relational database system.
- JWT Authentication: Secure authentication using HTTP-only cookies.
- File Storage: Local filesystem storage for PDF files.

## Getting Started

### Prerequisites

- Node.js (>=18.0.0)
- PostgreSQL database

### Installation

1. Clone the repository

2. Install dependencies
```bash
npm install
```

3. Set up environment variables
```bash
cp .env.example .env
```
Then edit the `.env` file with your database credentials and other configuration.

4. Start the development server
```bash
npm run start:dev
```

## API Endpoints

### Auth
- POST /api/auth/signup - Create a new user account
- POST /api/auth/login - Login to an existing account
- POST /api/auth/logout - Logout
- GET /api/auth/me - Get current user info

### Files & Folders
- GET /api/folders - Get folders and files
- POST /api/folders - Create a new folder
- DELETE /api/folders/:id - Delete a folder
- POST /api/files - Upload a file
- DELETE /api/files/:id - Delete a file
- GET /api/files/:id/download - Download a file

### Chat
- POST /api/chat/start - Start a new chat session
- POST /api/chat/:sessionId/message - Send a message to the chat
- GET /api/chat/:sessionId/history - Get chat history

## Project Structure

- src/ - Source code
  - entities/ - Database entities
  - dto/ - Data Transfer Objects
  - controllers/ - Route controllers
  - services/ - Business logic
  - guards/ - Authentication guards
  - strategies/ - Authentication strategies

## License

This project is licensed under the MIT License.
