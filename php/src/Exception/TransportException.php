<?php

declare(strict_types=1);

namespace IShip\Exception;

/** The request never produced a usable response: network failure, timeout, or non-JSON body. */
final class TransportException extends IShipException
{
}
