/*
 * NetBox Phase 7 — POSIX C11 UDP Echo Client (localhost 127.0.0.1)
 * Usage: udp_client <port> [msg1] [msg2] ...
 * Sends each argument as a separate UDP datagram so students observe preserved
 * message boundaries and connectionless behavior.
 */
#define _POSIX_C_SOURCE 200809L

#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

int main(int argc, char *argv[]) {
    int port = 9090;
    if (argc >= 2) {
        port = atoi(argv[1]);
        if (port <= 0 || port > 65535) {
            fprintf(stderr, "Invalid port: %s\n", argv[1]);
            return 1;
        }
    }

    const char *default_msgs[] = {"Hello NetBox UDP Datagram!"};
    const char **msgs = default_msgs;
    int msg_count = 1;
    if (argc >= 3) {
        msgs = (const char **)&argv[2];
        msg_count = argc - 2;
    }

    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0) {
        perror("socket");
        return 1;
    }

    struct timeval tv;
    tv.tv_sec = 0;
    tv.tv_usec = 600000;
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    struct sockaddr_in server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons((uint16_t)port);
    if (inet_pton(AF_INET, "127.0.0.1", &server_addr.sin_addr) != 1) {
        perror("inet_pton");
        close(fd);
        return 1;
    }

    int failures = 0;
    char buf[2048];
    for (int i = 0; i < msg_count; i++) {
        size_t len = strlen(msgs[i]);
        ssize_t sent = sendto(fd, msgs[i], len, 0,
                              (struct sockaddr *)&server_addr, sizeof(server_addr));
        if (sent < 0) {
            perror("sendto");
            failures++;
            continue;
        }

        struct sockaddr_in from;
        socklen_t from_len = sizeof(from);
        ssize_t recvd = recvfrom(fd, buf, sizeof(buf) - 1, 0,
                                 (struct sockaddr *)&from, &from_len);
        if (recvd < 0) {
            fprintf(stderr, "Datagram %d no reply (errno=%d: %s)\n", i + 1, errno, strerror(errno));
            failures++;
        } else {
            buf[recvd] = '\0';
            printf("Datagram %d echoed (%zd bytes): %s\n", i + 1, recvd, buf);
        }
    }

    close(fd);
    return failures > 0 ? 2 : 0;
}
