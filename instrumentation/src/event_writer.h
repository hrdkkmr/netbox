#ifndef NETBOX_EVENT_WRITER_H
#define NETBOX_EVENT_WRITER_H

#include <stdint.h>
#include <sys/types.h>

typedef struct {
    uint64_t timestamp_ns;
    const char *event_type;
    int socket_fd;
    const char *socket_domain;
    const char *socket_type;
    const char *local_ip;
    int local_port;
    const char *remote_ip;
    int remote_port;
    ssize_t bytes_transferred;
    int64_t result;
    int error_code;
    const char *error_name;
    const char *error_message;
} event_data_t;

void event_writer_init(void);
void event_writer_cleanup(void);

void event_writer_write_event(const event_data_t *data);
const char *event_writer_get_run_id(void);
const char *event_writer_get_process_name(void);
int event_writer_get_fd(void);

const char *errno_to_symbolic_name(int err);

#endif /* NETBOX_EVENT_WRITER_H */
