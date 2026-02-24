# image scan result features

Import(rules=['models/base.sml'])

ImageIsSafe = JsonData(path='$.scan.is_safe', coerce_type=True, required=False)
ImageSeverity = JsonData(path='$.scan.severity', required=False)
