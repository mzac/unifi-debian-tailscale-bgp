#!/bin/sh
#
# (C) 2006-2011 by Pablo Neira Ayuso <pablo@netfilter.org>
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 2 of the License, or
# (at your option) any later version.
#
# Description:
#
# This is the script for primary-backup setups for keepalived
# (http://www.keepalived.org). You may adapt it to make it work with other
# high-availability managers.
#
# Do not forget to include the required modifications to your keepalived.conf
# file to invoke this script during keepalived's state transitions.
#
# Contributions to improve this script are welcome :).
#

CONNTRACKD_BIN=/usr/sbin/conntrackd
CONNTRACKD_LOCK=/var/lock/conntrack.lock
CONNTRACKD_CONFIG=/etc/conntrackd/conntrackd.conf

case "$1" in
  primary)
    #
    # commit the external cache into the kernel table
    #
    $CONNTRACKD_BIN -C $CONNTRACKD_CONFIG -c
    if [ $? -eq 1 ]
    then
        logger "ERROR: failed to invoke conntrackd -c"
    fi

    #
    # flush the internal and the external caches
    #
    $CONNTRACKD_BIN -C $CONNTRACKD_CONFIG -f
    if [ $? -eq 1 ]
    then
    	logger "ERROR: failed to invoke conntrackd -f"
    fi

    #
    # resynchronize my internal cache to the kernel table
    #
    $CONNTRACKD_BIN -C $CONNTRACKD_CONFIG -R
    if [ $? -eq 1 ]
    then
    	logger "ERROR: failed to invoke conntrackd -R"
    fi

    #
    # send a bulk update to backups 
    #
    $CONNTRACKD_BIN -C $CONNTRACKD_CONFIG -B
    if [ $? -eq 1 ]
    then
        logger "ERROR: failed to invoke conntrackd -B"
    fi
    ;;
  backup)
    #
    # is conntrackd running? request some statistics to check it
    #
    # LOCAL CHANGE (this guide): conntrackd belongs to systemd. The Debian example launched its own
    # `conntrackd -d` here (after removing the lock file), which ran a second, unmanaged copy at boot when
    # the unit had failed. Now: ask systemd to (re)start the unit; it never runs two copies.
    if ! $CONNTRACKD_BIN -C $CONNTRACKD_CONFIG -s >/dev/null 2>&1
    then
        logger "primary-backup.sh: conntrackd not answering, starting conntrackd.service"
        systemctl reset-failed conntrackd.service 2>/dev/null
        if ! systemctl start conntrackd.service
        then
            logger "ERROR: cannot start conntrackd.service"
            exit 1
        fi
    fi
    #
    # shorten kernel conntrack timers to remove the zombie entries.
    #
    $CONNTRACKD_BIN -C $CONNTRACKD_CONFIG -t
    if [ $? -eq 1 ]
    then
    	logger "ERROR: failed to invoke conntrackd -t"
    fi

    #
    # request resynchronization with master firewall replica (if any)
    # Note: this does nothing in the alarm approach.
    #
    $CONNTRACKD_BIN -C $CONNTRACKD_CONFIG -n
    if [ $? -eq 1 ]
    then
    	logger "ERROR: failed to invoke conntrackd -n"
    fi
    ;;
  fault)
    #
    # shorten kernel conntrack timers to remove the zombie entries.
    #
    $CONNTRACKD_BIN -C $CONNTRACKD_CONFIG -t
    if [ $? -eq 1 ]
    then
    	logger "ERROR: failed to invoke conntrackd -t"
    fi
    ;;
  *)
    logger "ERROR: unknown state transition"
    echo "Usage: primary-backup.sh {primary|backup|fault}"
    exit 1
    ;;
esac

exit 0
