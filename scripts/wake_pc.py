#!/usr/bin/env python3
import argparse
import socket


def send_magic_packet(mac_address: str) -> None:
    clean = mac_address.replace(":", "").replace("-", "")
    if len(clean) != 12:
        raise ValueError("Invalid MAC address")
    packet = bytes.fromhex("FF" * 6 + clean * 16)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.sendto(packet, ("255.255.255.255", 9))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Send a Wake-on-LAN magic packet.")
    parser.add_argument("mac_address")
    args = parser.parse_args()
    send_magic_packet(args.mac_address)
