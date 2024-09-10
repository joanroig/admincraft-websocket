<p align="center">
  <a href="https://github.com/joanroig/admincraft-websocket">
      <img alt="Admincraft WebSocket logo" src="logo.png" width="140px">
  </a>
</p>

<h1 align="center">
  Admincraft WebSocket
</h1>

<p align="center">
  WebSocket server to control Minecraft Bedrock Dockerized servers with <a href="https://github.com/joanroig/admincraft">Admincraft</a>.
</p>

<p align="center">
    <a href="https://github.com/joanroig/admincraft">
        <img src="https://img.shields.io/badge/Admincraft-339933?style=flat-square&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABfUlEQVR4AW2SvU5CQRCFJ2ZbKPCHiDWGhsJYGOgNnQVRW1ueQSsL34HW2khhR+i1MhY2RGswkgsFPIDcb+BsFuJJyHLn58ycmQnPt5d/k+ncwO9s4W+9emTbtnG2sMpeIfo/v0f+Bv6USwX7+BrHAJJ3auf2/vLoNgLLpbmTiRzCcTa0gCHbP7PKrOdEB7tFZ7fXXkz27zX6b0N/W42a24O3Oh14YPvhybqdlhOl1fTNuy0xxIo5endX1un2nQRIJ1XpBll0RrIk+wzQAzsOkiG5v266TclAM6EbyfMZmI1ii2ky3bUaxdhJvbrqSpIoGNT+fzOADLTXA5S0dB5BU+Y3yQNSJ50AfesmwMYMdAepE0h7mriSbC6bvCCHhiKnVgUZO9cNcFDgsNm2n3wjQXp1gemp4ju9uLHJcBCLQHhyXPFkthdI5g+BGFU5XmBuS6E1aisuQYw6HkHdUQAZuomNS9wO0mEB2bR/ChEreU6gagTq7jUkna2QrlhFl4X7LZs6I3I3AAAAAElFTkSuQmCC" alt="Admincraft badge"/>
    </a>
    <a href="https://nodejs.org">
        <img src="https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=fff&style=flat-square" alt="Node.js badge"/>
    </a>
    <a href="https://github.com/joanroig/admincraft-websocket/issues">
        <img src="https://img.shields.io/github/issues-raw/joanroig/admincraft-websocket.svg?maxAge=2592000&label=Open Issues&style=flat-square&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAMtJREFUOI1j1G5l+M+ABSiJ1GMTZmC++pqBgYGB4bb4NAYGBgYGJqyqSAAsMIbqyywUkzlfQxz2XZQRla8tysDAwMCg/bqOyi5gExNBccl3bTSboS6BhcEvqD7KXYBhIwPEJQw4woAB6lKYOOUugPndMDQSReL8tGUoNhtmRWGVp14sHFu9nIGBgYHhz823DAwMDAx2NTkoCg+1TEHh8woJUccFjGEtdSh5Ad2v6ADmd6rFAqNnUc5/BgaEnz6/e4dXA0zdr1dvqOMCAHUPQJl6c3AoAAAAAElFTkSuQmCC" alt="Open issues" />
    </a>
    <a href="https://hub.docker.com/r/joanroig/admincraft-websocket">
        <img src="https://img.shields.io/docker/pulls/joanroig/admincraft-websocket?style=flat-square&logo=docker&label=Docker Pulls" alt="Docker Pulls"/>
    </a>
</p>

## What is Admincraft WebSocket?

Admincraft WebSocket allows remote control of Minecraft Bedrock servers hosted in Docker. It uses WebSocket technology to provide secure, real-time communication with the Minecraft server, executing commands and monitoring server activity from anywhere.

### Current Project Status

- Designed to work alongside [Admincraft](https://github.com/joanroig/admincraft) for GUI-based server management.
- Currently optimized for use with Oracle Always Free, using a server created with [docker-minecraft-bedrock-server](https://github.com/itzg/docker-minecraft-bedrock-server/tree/master).

## Getting Started

### Prerequisites

To run Admincraft WebSocket, ensure you have the [Docker](https://www.docker.com/) installed.

### Installation

You can set up your server following [the server setup guide from Admincraft](https://github.com/joanroig/admincraft/blob/main/docs/server/SERVER_SETUP.md), in summary you need to:

1. **Set up your environment:**

   Get the `docker-compose.yml` file and edit it with your secret key:

   `SECRET_KEY=your_secret_key_here`

2. **Build and run the Docker container:**

   `sudo docker-compose up --build`

   The WebSocket server will be available on port `8080`.

## Development

### Running Locally

1. **Run a demo container**

   `sudo docker run -p 8080:8080 --name admincraft-websocket -e SECRET_KEY=your_secret_key_here admincraft-websocket`

2. The server will start on port `8080` by default.

### Running together with docker compose

Change the websocket service in the `docker-compose.yml` file to remove the image configuration and add the build configuration to point to the local folder with the project code:

```
version: "3"
services:

  [...]

  websocket:
    container_name: websocket
    build:
      context: ./admincraft-websocket
      dockerfile: Dockerfileadmincraft-websocket:latest
    restart: always
    depends_on:
      # Make sure the minecraft service starts before the websockets service
      minecraft:
        condition: service_healthy
    ports:
      - 8080:8080
    volumes:
      # Mount Docker socket
      - /var/run/docker.sock:/var/run/docker.sock
      # Needed if environment.USE_SSL is "true"
      - ./certs:/usr/src/app/certs:ro
    environment:
      # Login password to use in admincraft (use alphanumeric characters only)
      SECRET_KEY: YOUR_SECRET_KEY_HERE
      # Enable or disable SSL
      USE_SSL: "false"
```

You can also run a separate docker compose file by providing it:
`sudo docker compose -f docker-compose_ssl.yml up -d`

#### Troubleshoot

You can stop the servers, remove all containers and all images with:

```
sudo docker compose down
sudo docker rm -vf $(sudo docker ps -aq)
sudo docker rmi -f $(sudo docker images -aq)
```

### Docker Build & Push

To build and push the Docker image to a repository:

1. **Build the Docker image:**

   `sudo docker build -t your-docker-username/admincraft-websocket .`

2. **Tag the image:**

   `sudo docker tag your-docker-username/admincraft-websocket your-docker-username/admincraft-websocket:latest`

3. **Push the image to Docker Hub:**

   `sudo docker push your-docker-username/admincraft-websocket:latest`

### Architecture

The Admincraft WebSocket Server operates alongside a Minecraft Bedrock server hosted in Docker. All arechitecture details can be found [here](https://github.com/joanroig/admincraft/blob/main/docs/server/SERVER_SETUP.md#architecture).

## License

Licensed under the [GPLv3 License](https://github.com/joanroig/admincraft-websocket/blob/main/LICENSE).
