#define _GNU_SOURCE
#include "event_writer.h"
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <pthread.h>
#include <sys/file.h>
#include <sys/syscall.h>

static int g_event_fd = -1;
static int g_own_fd = 0;
static char g_run_id[128] = "run_default";
static char g_process_name[128] = "unknown";
static uint64_t g_sequence = 1;
static pthread_mutex_t g_writer_mutex = PTHREAD_MUTEX_INITIALIZER;
static int g_initialized = 0;

const char *errno_to_symbolic_name(int err) {
    switch (err) {
        case 0:             return NULL;
        case ECONNREFUSED:  return "ECONNREFUSED";
        case EADDRINUSE:    return "EADDRINUSE";
        case EADDRNOTAVAIL: return "EADDRNOTAVAIL";
        case EAGAIN:        return "EAGAIN";
        case EALREADY:      return "EALREADY";
        case EBADF:         return "EBADF";
        case ECONNRESET:    return "ECONNRESET";
        case EDESTADDRREQ:  return "EDESTADDRREQ";
        case EFAULT:        return "EFAULT";
        case EINPROGRESS:   return "EINPROGRESS";
        case EINTR:         return "EINTR";
        case EINVAL:        return "EINVAL";
        case EISCONN:       return "EISCONN";
        case EMFILE:        return "EMFILE";
        case ENETDOWN:      return "ENETDOWN";
        case ENETUNREACH:   return "ENETUNREACH";
        case ENFILE:        return "ENFILE";
        case ENOBUFS:       return "ENOBUFS";
        case ENOPROTOOPT:   return "ENOPROTOOPT";
        case ENOTCONN:      return "ENOTCONN";
        case ENOTSOCK:      return "ENOTSOCK";
        case EOPNOTSUPP:    return "EOPNOTSUPP";
        case EPIPE:         return "EPIPE";
        case EPROTONOSUPPORT: return "EPROTONOSUPPORT";
        case ETIMEDOUT:     return "ETIMEDOUT";
        default:            return "ERR_OTHER";
    }
}

void event_writer_init(void) {
    pthread_mutex_lock(&g_writer_mutex);
    if (!g_initialized) {
        const char *env_run = getenv("NETBOX_RUN_ID");
        if (env_run && env_run[0] != '\0') {
            strncpy(g_run_id, env_run, sizeof(g_run_id) - 1);
            g_run_id[sizeof(g_run_id) - 1] = '\0';
        }

        const char *env_pname = getenv("NETBOX_PROCESS_NAME");
        if (env_pname && env_pname[0] != '\0') {
            strncpy(g_process_name, env_pname, sizeof(g_process_name) - 1);
            g_process_name[sizeof(g_process_name) - 1] = '\0';
        } else {
            // Read from /proc/self/comm
            int comm_fd = open("/proc/self/comm", O_RDONLY);
            if (comm_fd >= 0) {
                ssize_t r = read(comm_fd, g_process_name, sizeof(g_process_name) - 1);
                if (r > 0) {
                    if (g_process_name[r - 1] == '\n') {
                        g_process_name[r - 1] = '\0';
                    } else {
                        g_process_name[r] = '\0';
                    }
                }
                close(comm_fd);
            }
        }

        const char *env_file = getenv("NETBOX_EVENT_FILE");
        if (env_file && env_file[0] != '\0') {
            g_event_fd = open(env_file, O_WRONLY | O_CREAT | O_APPEND, 0644);
            if (g_event_fd >= 0) {
                g_own_fd = 1;
            } else {
                g_event_fd = STDERR_FILENO;
                g_own_fd = 0;
            }
        } else {
            g_event_fd = STDERR_FILENO;
            g_own_fd = 0;
        }

        g_sequence = 1;
        g_initialized = 1;
    }
    pthread_mutex_unlock(&g_writer_mutex);
}

void event_writer_cleanup(void) {
    pthread_mutex_lock(&g_writer_mutex);
    if (g_initialized) {
        if (g_own_fd && g_event_fd >= 0) {
            close(g_event_fd);
            g_event_fd = -1;
        }
        g_initialized = 0;
    }
    pthread_mutex_unlock(&g_writer_mutex);
}

const char *event_writer_get_run_id(void) {
    return g_run_id;
}

const char *event_writer_get_process_name(void) {
    return g_process_name;
}

int event_writer_get_fd(void) {
    return g_event_fd;
}

void event_writer_write_event(const event_data_t *data) {
    if (!data) return;

    if (!g_initialized) {
        event_writer_init();
    }

    pid_t pid = getpid();
    pid_t tid = (pid_t)syscall(SYS_gettid);

    pthread_mutex_lock(&g_writer_mutex);
    uint64_t seq = g_sequence++;
    int fd = (g_event_fd >= 0) ? g_event_fd : STDERR_FILENO;

    char buf[2048];
    int offset = 0;

    offset += snprintf(buf + offset, sizeof(buf) - offset,
        "{\"schema_version\":\"1.0\","
        "\"run_id\":\"%s\","
        "\"sequence\":%llu,"
        "\"timestamp_ns\":%llu,"
        "\"source\":\"socket_api\","
        "\"event_type\":\"%s\","
        "\"process\":{\"pid\":%d,\"tid\":%d,\"name\":\"%s\"},",
        g_run_id,
        (unsigned long long)seq,
        (unsigned long long)data->timestamp_ns,
        data->event_type ? data->event_type : "unknown",
        (int)pid,
        (int)tid,
        g_process_name
    );

    // Connection object
    if ((data->local_ip && data->local_ip[0] != '\0') ||
        (data->remote_ip && data->remote_ip[0] != '\0') ||
        data->local_port > 0 || data->remote_port > 0) {
        
        offset += snprintf(buf + offset, sizeof(buf) - offset, "\"connection\":{");
        if (data->local_ip && data->local_ip[0] != '\0') {
            offset += snprintf(buf + offset, sizeof(buf) - offset, "\"local_ip\":\"%s\",", data->local_ip);
        } else {
            offset += snprintf(buf + offset, sizeof(buf) - offset, "\"local_ip\":null,");
        }
        if (data->local_port > 0) {
            offset += snprintf(buf + offset, sizeof(buf) - offset, "\"local_port\":%d,", data->local_port);
        } else {
            offset += snprintf(buf + offset, sizeof(buf) - offset, "\"local_port\":null,");
        }
        if (data->remote_ip && data->remote_ip[0] != '\0') {
            offset += snprintf(buf + offset, sizeof(buf) - offset, "\"remote_ip\":\"%s\",", data->remote_ip);
        } else {
            offset += snprintf(buf + offset, sizeof(buf) - offset, "\"remote_ip\":null,");
        }
        if (data->remote_port > 0) {
            offset += snprintf(buf + offset, sizeof(buf) - offset, "\"remote_port\":%d},", data->remote_port);
        } else {
            offset += snprintf(buf + offset, sizeof(buf) - offset, "\"remote_port\":null},");
        }
    } else {
        offset += snprintf(buf + offset, sizeof(buf) - offset, "\"connection\":null,");
    }

    // Socket FD & Domain & Type
    if (data->socket_fd >= 0) {
        offset += snprintf(buf + offset, sizeof(buf) - offset, "\"socket_fd\":%d,", data->socket_fd);
    } else {
        offset += snprintf(buf + offset, sizeof(buf) - offset, "\"socket_fd\":null,");
    }

    if (data->socket_domain) {
        offset += snprintf(buf + offset, sizeof(buf) - offset, "\"socket_domain\":\"%s\",", data->socket_domain);
    } else {
        offset += snprintf(buf + offset, sizeof(buf) - offset, "\"socket_domain\":null,");
    }

    if (data->socket_type) {
        offset += snprintf(buf + offset, sizeof(buf) - offset, "\"socket_type\":\"%s\",", data->socket_type);
    } else {
        offset += snprintf(buf + offset, sizeof(buf) - offset, "\"socket_type\":null,");
    }

    // Payload metadata (privacy preserving: count only by default)
    if (data->bytes_transferred >= 0) {
        offset += snprintf(buf + offset, sizeof(buf) - offset, "\"payload\":{\"bytes\":%zd},", data->bytes_transferred);
    } else {
        offset += snprintf(buf + offset, sizeof(buf) - offset, "\"payload\":null,");
    }

    // Result & Error
    offset += snprintf(buf + offset, sizeof(buf) - offset, "\"result\":%lld,", (long long)data->result);

    if (data->error_code != 0) {
        offset += snprintf(buf + offset, sizeof(buf) - offset, "\"error_code\":%d,", data->error_code);
        if (data->error_name) {
            offset += snprintf(buf + offset, sizeof(buf) - offset, "\"error_name\":\"%s\",", data->error_name);
        } else {
            offset += snprintf(buf + offset, sizeof(buf) - offset, "\"error_name\":null,");
        }
        if (data->error_message) {
            offset += snprintf(buf + offset, sizeof(buf) - offset, "\"error_message\":\"%s\",", data->error_message);
        } else {
            offset += snprintf(buf + offset, sizeof(buf) - offset, "\"error_message\":null,");
        }
    } else {
        offset += snprintf(buf + offset, sizeof(buf) - offset,
            "\"error_code\":null,\"error_name\":null,\"error_message\":null,");
    }

    // Phase 2 markers: explicitly actual events
    offset += snprintf(buf + offset, sizeof(buf) - offset,
        "\"is_simulated\":false,\"simulation_label\":\"ACTUAL SOCKET API EVENTS\"}\n");

    if (offset > (int)sizeof(buf)) {
        offset = sizeof(buf);
    }

    // Write line atomically
    ssize_t written = write(fd, buf, (size_t)offset);
    (void)written;

    pthread_mutex_unlock(&g_writer_mutex);
}
