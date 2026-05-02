def classificar(score):
    if score <= 30:
        return "Falso"
    elif score <= 60:
        return "Duvidoso"
    elif score <= 80:
        return "Parcialmente verdadeiro"
    else:
        return "Confiável"