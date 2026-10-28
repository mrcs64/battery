// Observational only: no notification posts, state writes, or privileged APIs.
#include <notify.h>
#include <stdint.h>
#include <stdio.h>
int main(void) {
    int token;
    uint64_t state;
    if (notify_register_check("com.apple.system.powersources.chargingtofulloverride", &token) != NOTIFY_STATUS_OK) return 1;
    uint32_t result = notify_get_state(token, &state);
    notify_cancel(token);
    if (result != NOTIFY_STATUS_OK || state > 1) return 1;
    printf("{\"version\":1,\"override\":%llu}\n", (unsigned long long)state);
    return 0;
}
