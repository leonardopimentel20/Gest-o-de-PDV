# Usa uma versão oficial do Node.js
FROM node:18-alpine

# Define a pasta de trabalho dentro do container
WORKDIR /app

# Copia os arquivos de dependências
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia todo o resto do seu código para dentro do container
COPY . .

# Expõe a porta que sua aplicação usa (mude para a porta do seu app, ex: 3000)
EXPOSE 3000

# Comando para iniciar a aplicação
CMD ["npm", "start"]