"""plyr.fm Osprey plugin.

registers custom input stream, output sink, and UDFs
for the plyr.fm moderation rules engine.
"""

from typing import Any, Sequence, Type

from osprey.engine.udf.base import UDFBase
from osprey.worker.adaptor.plugin_manager import hookimpl_osprey
from osprey.worker.lib.config import Config
from osprey.worker.sinks.sink.output_sink import BaseOutputSink, StdoutOutputSink

from plugin.input_stream import RedisStreamInput
from plugin.output_sink import PlyrOutputSink


@hookimpl_osprey
def register_output_sinks(config: Config) -> Sequence[BaseOutputSink]:
    return [
        PlyrOutputSink.from_env(),
        StdoutOutputSink(log_sampler=None),
    ]


@hookimpl_osprey
def register_input_stream(config: Config) -> RedisStreamInput:
    return RedisStreamInput.from_env()


@hookimpl_osprey
def register_udfs() -> Sequence[Type[UDFBase[Any, Any]]]:
    # UDFs are registered here as we add them in later phases
    return []
