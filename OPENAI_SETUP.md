# OpenAI API Configuration

This document explains how to properly configure the OpenAI API key for the PDFizz AI backend.

## Setup Steps

1. **Get your OpenAI API Key**
   - Go to [OpenAI Platform](https://platform.openai.com/api-keys)
   - Sign in to your account
   - Create a new API key or use an existing one
   - Copy the API key (it starts with `sk-`)

2. **Configure Environment Variables**
   - Copy `.env.example` to `.env`
   - Replace `your-openai-api-key` with your actual OpenAI API key:
     ```
     OPENAI_API_KEY=sk-your-actual-api-key-here
     ```

3. **Verify Configuration**
   - The application will validate the API key on startup
   - Check the logs for any authentication errors
   - If you see "OPENAI_API_KEY not found" error, ensure the key is properly set in your `.env` file

## Common Issues

- **401 Unauthorized**: Your API key is invalid or expired
- **Quota Exceeded**: You've reached your OpenAI usage limits
- **Missing API Key**: The `OPENAI_API_KEY` environment variable is not set

## Model Used

The application currently uses the `gpt-4.1-nano` model for chat responses. Make sure your OpenAI account has access to this model.

## Security Notes

- Never commit your actual API key to version control
- Keep your `.env` file in `.gitignore`
- Rotate your API keys regularly for security