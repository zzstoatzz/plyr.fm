from beartype.claw import beartype_this_package

beartype_this_package()


def hello() -> str:
    return "Hello from backend!"
