# Use the official Node.js image as a base
FROM node:latest

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install && apt-get update && apt-get install -y docker.io 

# Copy the rest of the application code
COPY . .

# Expose the WebSocket port
EXPOSE 8080

# Define the command to run the application
CMD ["npm", "start"]
