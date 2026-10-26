class LamportClock {
    constructor() {
        this.time = 0;
    }

    increment() {
        this.time += 1;
        return this.time;
    }

    sendEvent() {
        this.time += 1;
        return this.time;
    }

    receiveEvent(receivedTime) {
        this.time = Math.max(this.time, receivedTime) + 1;
        return this.time;
    }

    getTime() {
        return this.time;
    }
}

module.exports = LamportClock;
