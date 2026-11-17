#define _POSIX_C_SOURCE 200809L

#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#define SERVER_IP "127.0.0.1"
#define SERVER_PORT 8080
#define BUFFER_SIZE 4096
#define DEFAULT_MESSAGE "Hello from NetBox TCP client!"

/*
 * Sends all `length` bytes over `sockfd`, handling EINTR and partial writes.
 * Returns 0 on success, -1 on failure.
 */
static int send_all(int sockfd, const char *buffer, size_t length) {
    size_t total_sent = 0;

    while (total_sent < length) {
        ssize_t sent = send(sockfd, buffer + total_sent, length - total_sent, 0);
        if (sent < 0) {
            if (errno == EINTR) {
                continue;
            }
            return -1;
        }
        if (sent == 0) {
            return -1;
        }
        total_sent += (size_t)sent;
    }

    return 0;
}

int main(int argc, char *argv[]) {
    if (argc > 2) {
        fprintf(stderr, "Usage: %s [message]\n", argv[0]);
        return EXIT_FAILURE;
    }

    const char *message = (argc == 2) ? argv[1] : DEFAULT_MESSAGE;
    size_t message_len = strlen(message);
    if (message_len == 0) {
        fprintf(stderr, "[client] Error: message cannot be empty.\n");
        return EXIT_FAILURE;
    }
    if (message_len >= BUFFER_SIZE) {
        fprintf(stderr, "[client] Error: message exceeds maximum length (%d bytes).\n",
                BUFFER_SIZE - 1);
        return EXIT_FAILURE;
    }

    /* 1. Create a TCP/IPv4 socket. */
    int client_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (client_fd < 0) {
        perror("[client] socket");
        return EXIT_FAILURE;
    }

    /* 2. Configure target address 127.0.0.1:8080 and initiate TCP handshake. */
    struct sockaddr_in server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(SERVER_PORT);
    if (inet_pton(AF_INET, SERVER_IP, &server_addr.sin_addr) != 1) {
        fprintf(stderr, "[client] Invalid server IPv4 address: %s\n", SERVER_IP);
        close(client_fd);
        return EXIT_FAILURE;
    }

    printf("[client] Connecting to %s:%d...\n", SERVER_IP, SERVER_PORT);
    if (connect(client_fd, (struct sockaddr *)&server_addr, sizeof(server_addr)) < 0) {
        perror("[client] connect");
        close(client_fd);
        return EXIT_FAILURE;
    }
    printf("[client] Connected to %s:%d (fd=%d)\n", SERVER_IP, SERVER_PORT, client_fd);

    /* 3. Send the message to the echo server. */
    printf("[client] Sending %zu byte(s): \"%s\"\n", message_len, message);
    if (send_all(client_fd, message, message_len) < 0) {
        perror("[client] send");
        close(client_fd);
        return EXIT_FAILURE;
    }

    /* 4. Receive the echoed bytes (loop because TCP is a byte stream, not message-framed). */
    char response[BUFFER_SIZE];
    size_t total_received = 0;
    while (total_received < message_len) {
        ssize_t bytes_read = recv(client_fd,
                                  response + total_received,
                                  message_len - total_received,
                                  0);
        if (bytes_read < 0) {
            if (errno == EINTR) {
                continue;
            }
            perror("[client] recv");
            close(client_fd);
            return EXIT_FAILURE;
        }
        if (bytes_read == 0) {
            fprintf(stderr, "[client] Server closed connection prematurely after %zu/%zu byte(s).\n",
                    total_received, message_len);
            close(client_fd);
            return EXIT_FAILURE;
        }
        total_received += (size_t)bytes_read;
    }
    response[total_received] = '\0';

    /* 5. Print the echoed response and verify payload match. */
    printf("[client] Received echo (%zu byte(s)): \"%s\"\n", total_received, response);
    if (strcmp(message, response) != 0) {
        fprintf(stderr, "[client] Warning: echoed response does not match sent message.\n");
        close(client_fd);
        return EXIT_FAILURE;
    }

    /* 6. Close the socket cleanly (sends TCP FIN). */
    if (close(client_fd) < 0) {
        perror("[client] close");
        return EXIT_FAILURE;
    }
    printf("[client] Connection closed cleanly.\n");

    return EXIT_SUCCESS;
}
